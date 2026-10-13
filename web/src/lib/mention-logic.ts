/**
 * Pure logic for mention trigger detection, token parsing, and insertion.
 * No UI dependencies — fully testable.
 *
 * Grammar:
 *   ![agent:Name]   ![ext:Name]   ![team:Name]   — resolved via DB / executor
 *   ![EZ:Name]                                   — runtime actions (silent
 *     server-side ops; LLM never sees them — token is stripped pre-prompt
 *     by `src/runtime/mention-wiring.ts::stripEzActionTokens`)
 *   ![workflow:Name]                             — workflow REFERENCES
 *     (resolved from the merged workflow cache. Reference-only: the token
 *      expands to a system note describing the workflow; it never fires a
 *      run — execution goes through the `run_workflow` tool.)
 *   @[file:relative/path.ts]                     — project file references
 *   @[dir:relative/path]                         — project directory references
 *     (agent should read-all-files / write-into-folder for dir mentions)
 *   /[cmd:Name]                                  — slash-command expansions
 *     (discovered from .claude/.codex/agents dirs + userCommands DB)
 *   $[feature:Name]                              — Feature Index references
 *     (per-project; resolved via DB. Server-side expansion lives in
 *      src/runtime/mention-wiring.ts::applyFeatureExpansion.)
 *   %[lesson:Slug]                               — Lessons-Keeper references
 *     (per-user / per-project; resolved via DB. Server-side expansion lives
 *      in src/runtime/mention-wiring.ts::applyLessonExpansion.)
 */

/**
 * Char class for the `name` portion inside any `<sigil>[<kind>:<name>]`
 * structured token. Single source of truth so the final-token regex
 * (`MENTION_REGEX` below) and the server-side feature-expansion
 * regex (`src/runtime/mention-wiring.ts::FEATURE_TOKEN_RE`) cannot
 * drift. If we ever extend the allowed name characters (e.g. allow `:`
 * inside namespaced feature names), updating this constant updates
 * every downstream consumer at once.
 *
 * NOTE: the LIVE-TRIGGER regexes (BANG_TRIGGER_RE / AT_TRIGGER_RE /
 * SLASH_TRIGGER_RE / DOLLAR_TRIGGER_RE / PERCENT_TRIGGER_RE below) are
 * deliberately decoupled from this constant — they're matching the raw
 * "user is typing" sequence, not the final structured token, and have
 * their own constraints (e.g. DOLLAR_TRIGGER_RE rejects digit-leading
 * tails to dodge the `$5.00` false-positive — see comment there).
 */
export const STRUCTURED_NAME_CHAR_CLASS = "[^\\]]+";

// Structured token regex: matches `![kind:name]` (kind ∈
// agent/ext/team/EZ/workflow), `@[file|dir:name]`, `/[cmd:name]`,
// `$[feature:name]`, or `%[lesson:name]`.
// The five sigils are mutually exclusive at the trigger layer.
//
// The alternative COUNT is load-bearing: `web/src/lib/markdown.ts`'s
// `styleMentions` destructures these capture groups POSITIONALLY as named
// callback params. A new kind must go INSIDE an existing alternative's kind
// alternation (as `EZ` and `workflow` did) — adding a 6th top-level
// alternative renumbers groups 3-10 and silently mis-renders pills with no
// type error.
// Capture groups:
//   1 = kind  (agent|ext|team|EZ|workflow) when the ! alternative matches
//   2 = name  when the ! alternative matches
//   3 = kind  (file|dir)         when the @ alternative matches
//   4 = name  when the @ alternative matches
//   5 = kind  (cmd)              when the / alternative matches
//   6 = name  when the / alternative matches
//   7 = kind  (feature)          when the $ alternative matches
//   8 = name  when the $ alternative matches
//   9 = kind  (lesson)           when the % alternative matches
//  10 = name  when the % alternative matches
//
// `EZ` (uppercase) sits under the `!` sigil — it's the runtime-action kind
// (`![EZ:distill]` etc). Distinct from agent/ext/team because the LLM
// never sees these tokens (they're stripped pre-prompt server-side) and
// they invoke a server handler that returns a structured result card.
// The kind is uppercase to make it visually distinct from the
// lowercase logical-mention kinds at a glance and avoid collision with
// any existing or future agent/extension/team named "ez".
//
// `workflow` also sits under the `!` sigil — it's the "actor" sigil family,
// and a workflow is an actor. Unlike EZ, the token IS visible to the LLM:
// it expands server-side into a system note describing the workflow so the
// model can decide whether to call the `run_workflow` tool.
export const MENTION_REGEX = new RegExp(
	[
		`!\\[(agent|ext|team|EZ|workflow):(${STRUCTURED_NAME_CHAR_CLASS})\\]`,
		`@\\[(file|dir):(${STRUCTURED_NAME_CHAR_CLASS})\\]`,
		`\\/\\[(cmd):(${STRUCTURED_NAME_CHAR_CLASS})\\]`,
		`\\$\\[(feature):(${STRUCTURED_NAME_CHAR_CLASS})\\]`,
		`\\%\\[(lesson):(${STRUCTURED_NAME_CHAR_CLASS})\\]`,
	].join("|"),
	"g",
);

export type MentionKind =
	| "agent"
	| "ext"
	| "team"
	| "EZ"
	| "workflow"
	| "file"
	| "dir"
	| "cmd"
	| "feature"
	| "lesson";

export interface MentionTrigger {
	active: boolean;
	query: string;
	/**
	 * For the `!` sigil, may be undefined (no explicit prefix) or the concrete
	 * kind when the user typed `!agent:` / `!ext:` / `!team:` / `!workflow:`.
	 * For the `@` sigil, always `"path"` — the popover shows mixed file + dir
	 * results. The search API uses this to route to the project-filesystem
	 * branch (returning entries whose concrete `kind` is `"file"` or `"dir"`).
	 * For the `/` sigil, always `"cmd"` — the popover shows slash commands.
	 * For the `$` sigil, always `"feature"` — the popover shows Feature Index
	 * entries scoped to the active project.
	 * For the `%` sigil, always `"lesson"` — the popover shows Lessons-Keeper
	 * entries scoped to the active user + project (visibility-filtered).
	 */
	type?:
		| "ext"
		| "agent"
		| "team"
		| "EZ"
		| "workflow"
		| "path"
		| "cmd"
		| "feature"
		| "lesson";
	/** Which sigil activated the trigger. */
	sigil: "!" | "@" | "/" | "$" | "%";
}

export interface MentionToken {
	kind: MentionKind;
	name: string;
	start: number;
	end: number;
}

export type Segment =
	| { type: "text"; text: string }
	| { type: "mention"; kind: string; name: string; raw: string };

// Trigger regexes anchored to end-of-input-before-cursor.
// `!` captures an optional agent/ext/team/EZ/workflow: prefix and the query.
// `EZ:` is uppercase by design (matches the kind in the structured
// token `![EZ:name]`) — keeping the prefix case-sensitive prevents
// false-positive triggers on lowercase `ez:` typed mid-prose.
//
// SINGLE SOURCE OF TRUTH for the `!` kind-prefix alternation. It is used by
// BOTH {@link detectMentionTrigger} (live trigger detection) and
// {@link insertMentionToken} (span replacement). The two used to carry
// separate copies — a silent trap, because the replacement copy's `[^\s]*`
// tail swallows an unlisted prefix (`workflow:foo`) and keeps working, so a
// missed edit there is invisible until the day the tail stops matching.
const BANG_KIND_PREFIX = "(?:ext:|agent:|team:|EZ:|workflow:)?";
const BANG_TRIGGER_RE = new RegExp(`(?:^|\\s)!(${BANG_KIND_PREFIX}[^\\s]*)$`);
// `@` is dedicated to file references; the whole non-space tail is the query.
const AT_TRIGGER_RE = /(?:^|\s)@([^\s]*)$/;
// `/` is dedicated to slash-command references; same tail semantics as `@`.
const SLASH_TRIGGER_RE = /(?:^|\s)\/([^\s]*)$/;
// `$` is dedicated to Feature Index references. Unlike `@`/`/`, the `$`
// character collides with common JS / shell idioms — `${var}`, `$5.00`,
// `$5`, `$ARGUMENTS` — so we require the FIRST tail character to be a
// letter / underscore / hyphen (i.e. NOT a digit and NOT `{`/`(`/etc).
// This rejects price tags (`$5.00`) and template literals (`${var}`)
// without needing an exhaustive blocklist.
//
// Subsequent characters accept anything non-whitespace, mirroring the
// permissive tail shape of `@`/`/` — partial / mistyped queries like
// `$chat-` or `$x{` still keep the picker open until the user moves on
// (the API will simply return no matches and the picker dismisses on
// whitespace).
//
// Tradeoff: digit-leading feature names (e.g. a directory named
// `2c-mode`) won't trigger the picker via incremental typing. The user
// can still access them by typing `$` alone (empty query → full list)
// or by inserting via the settings UI. Digit-first slugs are uncommon
// in practice; the false-positive cost on every `$N.NN` price tag is
// the larger UX hit.
const DOLLAR_TRIGGER_RE = /(?:^|\s)\$([a-z_-][^\s]*|)$/i;
// `%` is dedicated to Lessons-Keeper references. Like `$`, the `%` character
// can collide with non-mention idioms (URL-encoded sequences `%20`, format
// strings `%s`, modulo expressions `5 % 2`), so we mirror DOLLAR_TRIGGER_RE
// and require the FIRST tail character to be a letter / underscore / hyphen.
// This rejects `5 % 2`, `%20`, and `printf("%s")` without an exhaustive
// blocklist while still allowing letter/hyphen-led slugs and the empty
// just-typed-`%` query (which opens the popover with the full visible list).
const PERCENT_TRIGGER_RE = /(?:^|\s)%([a-z_-][^\s]*|)$/i;

/**
 * Detect if the user is actively typing a mention trigger.
 * Returns null if none of `!` / `@` / `/` / `$` / `%` is at a word boundary,
 * or was dismissed (whitespace after the sigil with nothing else).
 *
 * When several could theoretically match, the last sigil before the cursor
 * wins — because each pattern anchors to `$` (end-of-input), only the
 * rightmost word-boundary sigil can produce a match.
 */
export function detectMentionTrigger(
	value: string,
	cursorPos: number,
): MentionTrigger | null {
	const before = value.slice(0, cursorPos);

	// Try `!` first. Because both patterns anchor at `$`, at most one can match
	// for a given `before`, so order is not load-bearing for correctness — but
	// `!` is tried first to keep behavior deterministic and mirror the legacy
	// priority of agent/ext/team over file references.
	const bang = before.match(BANG_TRIGGER_RE);
	if (bang) {
		const raw = bang[1]!;
		if (raw.startsWith("ext:"))
			return { active: true, query: raw.slice(4), type: "ext", sigil: "!" };
		if (raw.startsWith("agent:"))
			return { active: true, query: raw.slice(6), type: "agent", sigil: "!" };
		if (raw.startsWith("team:"))
			return { active: true, query: raw.slice(5), type: "team", sigil: "!" };
		// Case-insensitive on the EZ kind prefix at trigger time — `!ez:`,
		// `!Ez:`, `!EZ:` all route to the EZ search. The popover's selection
		// step always inserts the canonical `![EZ:name]` token regardless of
		// the typed casing, so persistence stays uniform.
		if (/^ez:/i.test(raw))
			return { active: true, query: raw.slice(3), type: "EZ", sigil: "!" };
		if (raw.startsWith("workflow:"))
			return { active: true, query: raw.slice(9), type: "workflow", sigil: "!" };
		return { active: true, query: raw, type: undefined, sigil: "!" };
	}

	const at = before.match(AT_TRIGGER_RE);
	if (at) {
		// `@` triggers the path popover which contains BOTH files and dirs.
		// Server returns entries with their concrete kind (`file` or `dir`)
		// and the selection step inserts the matching structured token.
		return { active: true, query: at[1]!, type: "path", sigil: "@" };
	}

	const slash = before.match(SLASH_TRIGGER_RE);
	if (slash) {
		// `/` triggers the slash-command popover. The search API routes this
		// to the command registry (filesystem + DB sources).
		return { active: true, query: slash[1]!, type: "cmd", sigil: "/" };
	}

	const dollar = before.match(DOLLAR_TRIGGER_RE);
	if (dollar) {
		// `$` triggers the Feature Index popover. The search API routes this
		// to the per-project `features` table.
		return { active: true, query: dollar[1]!, type: "feature", sigil: "$" };
	}

	const percent = before.match(PERCENT_TRIGGER_RE);
	if (percent) {
		// `%` triggers the Lessons-Keeper popover. The search API routes this
		// to the per-user / per-project `lessons` table (visibility-filtered).
		return { active: true, query: percent[1]!, type: "lesson", sigil: "%" };
	}

	return null;
}

/**
 * Extract all structured mention tokens from raw text.
 */
export function parseMentions(text: string): MentionToken[] {
	const mentions: MentionToken[] = [];
	const regex = new RegExp(MENTION_REGEX.source, "g");
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		// Alternative 1 matched (! sigil, agent/ext/team/EZ/workflow)
		if (match[1] !== undefined) {
			mentions.push({
				kind: match[1] as "agent" | "ext" | "team" | "EZ" | "workflow",
				name: match[2]!,
				start: match.index,
				end: match.index + match[0].length,
			});
		} else if (match[3] !== undefined) {
			// Alternative 2 matched (@ sigil, file or dir)
			mentions.push({
				kind: match[3] as "file" | "dir",
				name: match[4]!,
				start: match.index,
				end: match.index + match[0].length,
			});
		} else if (match[5] !== undefined) {
			// Alternative 3 matched (/ sigil, cmd)
			mentions.push({
				kind: match[5] as "cmd",
				name: match[6]!,
				start: match.index,
				end: match.index + match[0].length,
			});
		} else if (match[7] !== undefined) {
			// Alternative 4 matched ($ sigil, feature)
			mentions.push({
				kind: match[7] as "feature",
				name: match[8]!,
				start: match.index,
				end: match.index + match[0].length,
			});
		} else if (match[9] !== undefined) {
			// Alternative 5 matched (% sigil, lesson)
			mentions.push({
				kind: match[9] as "lesson",
				name: match[10]!,
				start: match.index,
				end: match.index + match[0].length,
			});
		}
	}
	return mentions;
}

/**
 * Locate the start index (within `before`) of the active trigger span
 * matched by `triggerRe`, skipping a single leading whitespace char when the
 * sigil was preceded by space/tab/newline rather than sitting at string
 * start. Returns null when the trigger isn't active at the cursor.
 *
 * Single source of truth for the span math shared by
 * {@link insertMentionToken}, {@link descendIntoFolder}, and
 * {@link insertCommandLiteral}.
 */
function triggerSpanStart(before: string, triggerRe: RegExp): number | null {
	const spanMatch = before.match(triggerRe);
	if (!spanMatch) return null;
	const firstChar = spanMatch[0][0]!;
	const leadingWs = firstChar === " " || firstChar === "\t" || firstChar === "\n" ? 1 : 0;
	return before.length - spanMatch[0].length + leadingWs;
}

/**
 * Replace the active trigger span (sigil + query) with a structured mention
 * token. The sigil used is derived from the target kind:
 *   kind === "file" | "dir"           → `@[kind:name] ` (path references)
 *   kind === "cmd"                    → `/[kind:name] ` (slash commands)
 *   kind === "feature"                → `$[kind:name] ` (Feature Index)
 *   kind === "lesson"                 → `%[kind:name] ` (Lessons-Keeper)
 *   kind === "agent" | "ext" | "team"
 *          | "EZ" | "workflow"        → `![kind:name] ` (logical mentions)
 *
 * Returns new text and cursor position after the inserted token (including
 * the trailing space).
 */
export function insertMentionToken(
	value: string,
	cursorPos: number,
	mention: { kind: MentionKind; name: string },
): { text: string; cursor: number } {
	const before = value.slice(0, cursorPos);
	const isAtSigil = mention.kind === "file" || mention.kind === "dir";
	const isSlashSigil = mention.kind === "cmd";
	const isDollarSigil = mention.kind === "feature";
	const isPercentSigil = mention.kind === "lesson";

	// Match the trigger span that corresponds to the target sigil. We inspect
	// the same underlying regex used for detection — the replacement only
	// succeeds if the user is actually in a trigger for this sigil. The `!`
	// case reuses BANG_TRIGGER_RE verbatim; `triggerSpanStart` reads only
	// `match[0]`, so its capture group is inert here.
	const triggerRe = isAtSigil
		? /(?:^|\s)@[^\s]*$/
		: isSlashSigil
		? /(?:^|\s)\/[^\s]*$/
		: isDollarSigil
		? /(?:^|\s)\$[^\s]*$/
		: isPercentSigil
		? /(?:^|\s)%[^\s]*$/
		: BANG_TRIGGER_RE;
	const atStart = triggerSpanStart(before, triggerRe);
	if (atStart === null) return { text: value, cursor: cursorPos };

	const token = isAtSigil
		? `@[${mention.kind}:${mention.name}] `
		: isSlashSigil
		? `/[${mention.kind}:${mention.name}] `
		: isDollarSigil
		? `$[${mention.kind}:${mention.name}] `
		: isPercentSigil
		? `%[${mention.kind}:${mention.name}] `
		: `![${mention.kind}:${mention.name}] `;
	const after = value.slice(cursorPos);
	const newText = value.slice(0, atStart) + token + after;
	return { text: newText, cursor: atStart + token.length };
}

/**
 * Commit a built-in literal command (e.g. `/goal`) picked from the popover.
 *
 * Literal commands render as a compact pill whose width slightly exceeds its
 * short raw text, so in the overlay the pill overflows and visually swallows
 * a single trailing space. Commit TWO trailing spaces (normalising whatever
 * the entry carried) so the pill clears the cursor and the user gets a
 * visible gap to type the argument. The `/goal` interceptor trims
 * everything after the token, so the extra space has no wire effect.
 */
export function commitCommandLiteral(
	value: string,
	cursorPos: number,
	insertText: string,
): { text: string; cursor: number } {
	return insertCommandLiteral(value, cursorPos, insertText.trimEnd() + "  ");
}

/**
 * Replace the active `/` slash-command trigger span with raw literal text
 * (e.g. `"/goal "`) instead of a structured `/[cmd:name]` token.
 *
 * Used for built-in commands handled by a server-side text interceptor that
 * needs the literal command in the message body — the `/goal` autopilot is
 * matched by `isGoalCommand()` on `body.content.startsWith("/goal ")`, so it
 * must NOT be wrapped in an expandable mention token. No-op when there's no
 * `/` trigger active at the cursor.
 *
 * Returns new text and cursor position after the inserted literal.
 */
export function insertCommandLiteral(
	value: string,
	cursorPos: number,
	literal: string,
): { text: string; cursor: number } {
	const before = value.slice(0, cursorPos);
	const atStart = triggerSpanStart(before, /(?:^|\s)\/[^\s]*$/);
	if (atStart === null) return { text: value, cursor: cursorPos };
	const after = value.slice(cursorPos);
	const newText = value.slice(0, atStart) + literal + after;
	return { text: newText, cursor: atStart + literal.length };
}

/**
 * Format a relative path for compact display in the mention popover.
 *
 * When the path is short (≤ `maxSegments` segments, default 2), returns it
 * unchanged. Otherwise middle-truncates it into `first/.../last` form so the
 * user can tell which top-level folder the entry lives under and which file
 * it resolves to, without the middle bloating the popover row.
 *
 * Examples (`maxSegments = 2`):
 *   "app.ts"                          → "app.ts"
 *   "src/app.ts"                      → "src/app.ts"
 *   "src/nested/deep.ts"              → "src/.../deep.ts"
 *   "a/b/c/d/e/leaf.ts"               → "a/.../leaf.ts"
 *
 * Leading / trailing / duplicate slashes are normalised out before counting
 * segments; preserving them in the output would confuse users about what
 * path actually got stored.
 */
export function formatPathDisplay(path: string, maxSegments: number = 2): string {
	const segments = path.split("/").filter((s) => s.length > 0);
	if (segments.length <= maxSegments) return segments.join("/");
	return `${segments[0]}/.../${segments[segments.length - 1]}`;
}

/**
 * Rewrite the currently-active `@` trigger span to represent a folder-descent
 * (i.e., `@<folderPath>/`). Used by the mention popover when the user clicks
 * or Enters a folder entry — we rewrite the textarea so the next trigger
 * detection re-fires the search inside that folder instead of inserting a
 * token immediately.
 *
 * Behaviour:
 *   - preserves text before/after the trigger
 *   - always appends a trailing `/` (strips existing trailing slashes on the
 *     input path first, so the result has exactly one)
 *   - no-op if there's no `@` trigger at the cursor
 *
 * This is deliberately distinct from `insertMentionToken({kind:"dir", …})` —
 * descent is a navigation operation, not a commit.
 */
export function descendIntoFolder(
	value: string,
	cursorPos: number,
	folderPath: string,
): { text: string; cursor: number } {
	const before = value.slice(0, cursorPos);
	const atStart = triggerSpanStart(before, /(?:^|\s)@[^\s]*$/);
	if (atStart === null) return { text: value, cursor: cursorPos };

	const trimmed = folderPath.replace(/\/+$/, "");
	const insert = `@${trimmed}/`;
	const after = value.slice(cursorPos);
	const newText = value.slice(0, atStart) + insert + after;
	return { text: newText, cursor: atStart + insert.length };
}

/**
 * Built-in slash commands that are inserted as LITERAL text (e.g. `/goal `)
 * instead of a structured `/[cmd:name]` token, because a server-side text
 * interceptor matches on the raw message body — see {@link insertCommandLiteral}
 * and `src/runtime/goal-host.ts`'s `isGoalCommand`. {@link getSegments} still
 * renders them as command pills so they're visually indistinguishable from
 * token-backed `/` commands in the composer (and chat history). Keep this list
 * in sync with the `insertText` entries the `/api/mentions/search` route emits.
 */
export const LITERAL_COMMAND_NAMES = ["goal"] as const;

// Matches a leading literal built-in command, allowing optional indentation,
// where the command token is followed by end-of-string or whitespace. Anchored
// at `^` to mirror `isGoalCommand`: only a command that *leads* the
// (left-trimmed) message is treated as a command, so `/goalpost` and a mid-prose
// `/goal` never match — exactly the cases the server also ignores.
const LEADING_LITERAL_COMMAND_RE = new RegExp(
	`^(\\s*)\\/(${LITERAL_COMMAND_NAMES.join("|")})(?=$|\\s)`,
);

/**
 * Split raw text into segments for overlay rendering.
 *
 * A leading literal built-in command (e.g. `/goal …`) is peeled off first and
 * emitted as a `cmd` mention segment so it renders as a command pill, even
 * though it's stored as raw text rather than a `/[cmd:…]` token. The remainder
 * is then parsed for structured tokens as usual — so `/goal review @[file:x]`
 * yields a `/goal` pill *and* a file pill.
 */
export function getSegments(text: string): Segment[] {
	const literal = text.match(LEADING_LITERAL_COMMAND_RE);
	if (literal) {
		const leadingWs = literal[1]!;
		const name = literal[2]!;
		const raw = `/${name}`;
		const out: Segment[] = [];
		if (leadingWs) out.push({ type: "text", text: leadingWs });
		out.push({ type: "mention", kind: "cmd", name, raw });
		const rest = text.slice(leadingWs.length + raw.length);
		if (rest.length > 0) out.push(...parseStructuredSegments(rest));
		return out;
	}
	return parseStructuredSegments(text);
}

/**
 * Split raw text into text + structured-mention segments via MENTION_REGEX.
 * The literal-command peel in {@link getSegments} runs before this.
 */
function parseStructuredSegments(text: string): Segment[] {
	const segments: Segment[] = [];
	const regex = new RegExp(MENTION_REGEX.source, "g");
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			segments.push({ type: "text", text: text.slice(lastIndex, match.index) });
		}
		// Five alternatives in MENTION_REGEX — pick the capture pair that matched.
		let kind: string;
		let name: string;
		if (match[1] !== undefined) {
			kind = match[1]!;
			name = match[2]!;
		} else if (match[3] !== undefined) {
			kind = match[3]!;
			name = match[4]!;
		} else if (match[5] !== undefined) {
			kind = match[5]!;
			name = match[6]!;
		} else if (match[7] !== undefined) {
			kind = match[7]!;
			name = match[8]!;
		} else {
			kind = match[9]!;
			name = match[10]!;
		}
		segments.push({
			type: "mention",
			kind,
			name,
			raw: match[0],
		});
		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < text.length) {
		segments.push({ type: "text", text: text.slice(lastIndex) });
	}

	if (segments.length === 0 && text.length > 0) {
		segments.push({ type: "text", text });
	}

	return segments;
}
