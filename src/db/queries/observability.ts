import { eq, asc, sql } from "drizzle-orm";
import { getDb } from "../connection";
import { observabilityEvents, type ObservabilityEvent } from "../schema";

// ── Insert ──────────────────────────────────────────────────────────

/**
 * Record one observability event.
 *
 * `conversationId` is nullable and callers MUST pass it through
 * {@link persistableConversationId} rather than forwarding a raw scope
 * key: a workflow tool step's coordinate is the synthetic
 * `workflow-run:<id>`, which matches no `conversations` row and used to
 * make this insert fail the FK on every single call. The run it belongs
 * to is folded into `data.workflowRunId` instead, which is a column that
 * can actually hold it.
 */
export async function insertObservabilityEvent(data: {
  conversationId: string | null;
  messageId?: string;
  eventType: string;
  data: Record<string, unknown>;
  durationMs?: number;
}): Promise<ObservabilityEvent> {
  const rows = await getDb()
    .insert(observabilityEvents)
    .values({
      conversationId: data.conversationId,
      messageId: data.messageId ?? null,
      eventType: data.eventType,
      data: data.data,
      durationMs: data.durationMs ?? null,
    })
    .returning();
  return rows[0]!;
}

// ── Per-Conversation Queries ────────────────────────────────────────

export async function getConversationObservability(conversationId: string): Promise<ObservabilityEvent[]> {
  return getDb()
    .select()
    .from(observabilityEvents)
    .where(eq(observabilityEvents.conversationId, conversationId))
    .orderBy(asc(observabilityEvents.createdAt));
}

export interface ConversationStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
  avgDurationMs: number;
  turnCount: number;
}

export async function getConversationStats(conversationId: string): Promise<ConversationStats> {
  const db = getDb();

  // Authoritative token + turn counts come from the messages table —
  // every assistant message stores its own usage, which is what you'd expect
  // a "turns" counter to reflect. turn_summary observability rows only
  // capture the LAST turn of a run, so sourcing from them under-reports
  // multi-turn conversations.
  const msgRows = await db.execute(sql`
    SELECT
      COALESCE(SUM((usage->>'inputTokens')::int), 0) as total_input_tokens,
      COALESCE(SUM((usage->>'outputTokens')::int), 0) as total_output_tokens,
      COUNT(*) FILTER (WHERE usage IS NOT NULL) as turn_count
    FROM messages
    WHERE conversation_id = ${conversationId}
      AND role = 'assistant'
  `);

  // Response-time averages stay with observability_events (messages have no duration).
  const durRows = await db.execute(sql`
    SELECT COALESCE(AVG(duration_ms), 0) as avg_duration_ms
    FROM observability_events
    WHERE conversation_id = ${conversationId}
      AND event_type = 'turn_summary'
  `);

  // Count tool calls from observability events
  const toolRows = await db.execute(sql`
    SELECT COUNT(*) as tool_count
    FROM observability_events
    WHERE conversation_id = ${conversationId}
      AND event_type = 'tool_call'
  `);

  const msg = msgRows.rows[0] as { total_input_tokens: number | string; total_output_tokens: number | string; turn_count: number | string };
  const dur = durRows.rows[0] as { avg_duration_ms: number | string };
  const tool = toolRows.rows[0] as { tool_count: number | string };

  return {
    totalInputTokens: Number(msg.total_input_tokens),
    totalOutputTokens: Number(msg.total_output_tokens),
    totalToolCalls: Number(tool.tool_count),
    avgDurationMs: Math.round(Number(dur.avg_duration_ms)),
    turnCount: Number(msg.turn_count),
  };
}

// ── Global Stats ────────────────────────────────────────────────────

export interface GlobalStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
  totalTurnCount: number;
  avgResponseMs: number;
  tokensByDay: { date: string; input: number; output: number }[];
  topExtensions: { extensionId: string; callCount: number; successRate: number; avgDurationMs: number }[];
}

/**
 * `conversation_id` filter for one user's own activity: conversations they
 * own, plus every sub-conversation below them (agent runs and team members
 * carry `user_id = NULL`; their owner is the root of the parent chain).
 * `UNION` (not `UNION ALL`) ends the walk on a corrupt parent cycle.
 */
function ownedConversationFilter(userId: string | undefined) {
  if (userId === undefined) return sql``;
  return sql`AND conversation_id IN (
    WITH RECURSIVE owned(id) AS (
      SELECT id FROM conversations WHERE user_id = ${userId}
      UNION
      SELECT c.id FROM conversations c JOIN owned o ON c.parent_conversation_id = o.id
    )
    SELECT id FROM owned
  )`;
}

/**
 * Usage totals for the dashboard. With `userId`, only that user's own
 * conversations (and their sub-conversations) count; without it, every
 * user's do — callers pass no `userId` for admins only.
 */
export async function getGlobalStats(options?: { days?: number; userId?: string }): Promise<GlobalStats> {
  const days = options?.days ?? 30;
  const db = getDb();
  const interval = `${days} days`;
  const owned = ownedConversationFilter(options?.userId);

  // Authoritative token + turn counts come from messages.usage. Each assistant
  // message records its own token usage; observability turn_summary rows only
  // capture the LAST turn of a run, which under-reports multi-turn runs and
  // can render an empty chart when the final turn had zero tokens. See the
  // getConversationStats comment for details.
  const msgRows = await db.execute(sql`
    SELECT
      COALESCE(SUM((usage->>'inputTokens')::int), 0) as total_input_tokens,
      COALESCE(SUM((usage->>'outputTokens')::int), 0) as total_output_tokens,
      COUNT(*) FILTER (WHERE usage IS NOT NULL) as turn_count
    FROM messages
    WHERE role = 'assistant'
      AND created_at >= NOW() - ${interval}::interval
      ${owned}
  `);

  // Response-time averages: keep from observability_events (messages have no duration).
  const durRows = await db.execute(sql`
    SELECT COALESCE(AVG(duration_ms), 0) as avg_response_ms
    FROM observability_events
    WHERE event_type = 'turn_summary'
      AND created_at >= NOW() - ${interval}::interval
      ${owned}
  `);

  // Tool call count
  const toolRows = await db.execute(sql`
    SELECT COUNT(*) as tool_count
    FROM observability_events
    WHERE event_type IN ('tool_call', 'tool_error')
      AND created_at >= NOW() - ${interval}::interval
      ${owned}
  `);

  // Tokens by day — sourced from messages.usage so multi-turn runs are
  // correctly reflected in the chart. Cast `day` to text so bun-sql returns
  // a YYYY-MM-DD string (plain DATE values come back as JS Date objects
  // whose `.toString()` is a long locale form).
  const dayRows = await db.execute(sql`
    SELECT
      to_char(created_at::date, 'YYYY-MM-DD') as day,
      COALESCE(SUM((usage->>'inputTokens')::int), 0) as input_tokens,
      COALESCE(SUM((usage->>'outputTokens')::int), 0) as output_tokens
    FROM messages
    WHERE role = 'assistant'
      AND usage IS NOT NULL
      AND created_at >= NOW() - ${interval}::interval
      ${owned}
    GROUP BY created_at::date
    ORDER BY created_at::date
  `);

  // Top extensions by call count
  const extRows = await db.execute(sql`
    SELECT
      data->>'extensionId' as extension_id,
      COUNT(*) as call_count,
      ROUND(AVG(CASE WHEN (data->>'success')::boolean THEN 1 ELSE 0 END) * 100) as success_rate,
      ROUND(AVG(duration_ms)) as avg_duration_ms
    FROM observability_events
    WHERE event_type IN ('tool_call', 'tool_error')
      AND created_at >= NOW() - ${interval}::interval
      ${owned}
    GROUP BY data->>'extensionId'
    ORDER BY call_count DESC
    LIMIT 10
  `);

  const msg = msgRows.rows[0] as { total_input_tokens: number | string; total_output_tokens: number | string; turn_count: number | string };
  const dur = durRows.rows[0] as { avg_response_ms: number | string };
  const tool = toolRows.rows[0] as { tool_count: number | string };

  type DayRow = { day: string; input_tokens: number | string; output_tokens: number | string };
  type ExtRow = { extension_id: string; call_count: number | string; success_rate: number | string; avg_duration_ms: number | string };

  return {
    totalInputTokens: Number(msg.total_input_tokens),
    totalOutputTokens: Number(msg.total_output_tokens),
    totalToolCalls: Number(tool.tool_count),
    totalTurnCount: Number(msg.turn_count),
    avgResponseMs: Math.round(Number(dur.avg_response_ms)),
    tokensByDay: (dayRows.rows as DayRow[]).map((r) => ({
      date: String(r.day),
      input: Number(r.input_tokens),
      output: Number(r.output_tokens),
    })),
    topExtensions: (extRows.rows as ExtRow[]).map((r) => ({
      extensionId: String(r.extension_id),
      callCount: Number(r.call_count),
      successRate: Number(r.success_rate),
      avgDurationMs: Number(r.avg_duration_ms),
    })),
  };
}
