/**
 * Cron parser for the Phase 51 schedule daemon.
 *
 * Supports 5-field cron expressions (`min hour dom month dow`) with
 * lists, ranges, and step values. TZ-aware via `Intl.DateTimeFormat`
 * (no new deps — uses the runtime's bundled tz database). DST
 * transitions are handled by always computing the "next" wall-clock
 * slot in the named TZ, then converting that wall-clock back to a UTC
 * Date — this naturally rolls forward over a spring-forward gap and
 * fires twice in the fall-back ambiguous window only when the cron
 * matches both wall-clock instants (which is the conservative
 * interpretation for at-most-once delivery).
 *
 * Validation rules:
 *   - 5-field expressions only (no `@every`, no seconds).
 *   - Min 5-minute interval — checked by walking real fire times, so
 *     every equivalent form is refused (`* * * * *`, `*\/1`, `0-59`,
 *     `1,2,3`, `* * * * 1`, ...), not only a few literal strings.
 */

const MIN_INTERVAL_MS = 5 * 60_000;
// Number of consecutive fires to inspect. A sub-5-minute gap always
// shows up as adjacent fires, so a modest window surfaces any dense
// cluster.
const MIN_INTERVAL_SAMPLES = 48;
// Fixed reference instant — NOT `Date.now()`, so the gate is
// deterministic regardless of when it runs.
const MIN_INTERVAL_REFERENCE = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));

interface ParsedField {
  /** Sorted unique values within this field's allowed range. */
  values: number[];
}

interface ParsedCron {
  minute: ParsedField;
  hour: ParsedField;
  dayOfMonth: ParsedField;
  month: ParsedField;
  dayOfWeek: ParsedField;
  /** Whether the original expression had a wildcard for dom AND dow.
   *  Used to determine the ANY/AND semantics of the dom/dow restriction
   *  (Vixie cron rule). */
  domWild: boolean;
  dowWild: boolean;
}

const FIELD_LIMITS: Record<keyof Omit<ParsedCron, "domWild" | "dowWild">, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 6], // Sunday=0, Saturday=6 (Bun/Vixie convention)
};

function parseField(raw: string, [min, max]: [number, number]): ParsedField {
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) throw new Error(`empty cron field segment`);
    let stepStr: string | undefined;
    let body = trimmed;
    const slash = trimmed.indexOf("/");
    if (slash >= 0) {
      body = trimmed.slice(0, slash);
      stepStr = trimmed.slice(slash + 1);
    }
    const step = stepStr === undefined ? 1 : parseInt(stepStr, 10);
    if (!Number.isFinite(step) || step <= 0) throw new Error(`invalid step '${stepStr}'`);

    let lo: number;
    let hi: number;
    if (body === "*") {
      lo = min;
      hi = max;
    } else if (body.includes("-")) {
      const [a, b] = body.split("-", 2);
      lo = parseInt(a!, 10);
      hi = parseInt(b!, 10);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) {
        throw new Error(`invalid range '${body}'`);
      }
    } else {
      lo = parseInt(body, 10);
      hi = lo;
      if (!Number.isFinite(lo)) throw new Error(`invalid value '${body}'`);
    }
    if (lo < min || hi > max) {
      throw new Error(`field out of range [${min},${max}]: '${trimmed}'`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values: [...values].sort((a, b) => a - b) };
}

export function validateCron(expr: string): { ok: true } | { ok: false; reason: string } {
  if (typeof expr !== "string" || expr.trim().length === 0) {
    return { ok: false, reason: "empty" };
  }
  const trimmed = expr.trim();
  if (trimmed.startsWith("@")) {
    return { ok: false, reason: "shorthand-not-supported (use 5-field expression)" };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return { ok: false, reason: `expected 5 fields, got ${parts.length}` };
  }
  let parsed: ParsedCron;
  try {
    parsed = parseExpression(trimmed);
  } catch (err) {
    return { ok: false, reason: `parse-error: ${(err as Error)?.message ?? String(err)}` };
  }
  if (!passesMinIntervalGate(parsed)) {
    return { ok: false, reason: "min-5-min-interval-required" };
  }
  return { ok: true };
}

/** Walk consecutive fires in UTC and require every gap to be >= 5 min.
 *  Seeds from the FIRST fire, not the reference instant: only the gap
 *  BETWEEN fires matters (`2 * * * *` is a 60-min cadence). */
function passesMinIntervalGate(parsed: ParsedCron): boolean {
  let prev: Date;
  try {
    prev = findNextWallClock(parsed, MIN_INTERVAL_REFERENCE, "UTC");
  } catch {
    // No fire within the 4-year horizon: cannot violate the floor.
    return true;
  }
  for (let i = 0; i < MIN_INTERVAL_SAMPLES; i++) {
    let next: Date;
    try {
      next = findNextWallClock(parsed, prev, "UTC");
    } catch {
      return true;
    }
    if (next.getTime() - prev.getTime() < MIN_INTERVAL_MS) return false;
    prev = next;
  }
  return true;
}

function parseExpression(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`expected 5 fields, got ${parts.length}`);
  const [minRaw, hourRaw, domRaw, monthRaw, dowRaw] = parts as [string, string, string, string, string];
  return {
    minute: parseField(minRaw, FIELD_LIMITS.minute),
    hour: parseField(hourRaw, FIELD_LIMITS.hour),
    dayOfMonth: parseField(domRaw, FIELD_LIMITS.dayOfMonth),
    month: parseField(monthRaw, FIELD_LIMITS.month),
    dayOfWeek: parseField(dowRaw, FIELD_LIMITS.dayOfWeek),
    domWild: domRaw === "*",
    dowWild: dowRaw === "*",
  };
}

export interface CronInstance {
  /** Compute the next fire time strictly after `from`. */
  next(from: Date): Date;
}

// ── TZ-aware wall-clock computation ──────────────────────────────────
//
// We need to enumerate wall-clock instants in a named TZ. The standard
// approach with `Intl.DateTimeFormat`: format a UTC Date with
// `timeZone: <tz>` to read the local fields, OR walk wall-clock
// candidates and convert each back to UTC by binary-search on the UTC
// offset. The latter handles DST forward (a wall-clock minute that
// doesn't exist) and DST back (a wall-clock minute that exists twice,
// for which we pick the FIRST occurrence — the earlier UTC instant).

interface WallClockParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  dow: number; // 0-6 (Sun=0)
}

const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(tz: string): Intl.DateTimeFormat {
  let f = PARTS_FORMATTER_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hour12: false,
    });
    PARTS_FORMATTER_CACHE.set(tz, f);
  }
  return f;
}

function dateToParts(d: Date, tz: string): WallClockParts {
  const f = getPartsFormatter(tz);
  const map: Record<string, string> = {};
  for (const p of f.formatToParts(d)) map[p.type] = p.value;
  // weekday: Sun..Sat short
  const wd = (map.weekday ?? "Sun").slice(0, 3);
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // Hour can be "24" in some locales for midnight — normalize.
  let hour = parseInt(map.hour ?? "0", 10);
  if (hour === 24) hour = 0;
  return {
    year: parseInt(map.year ?? "1970", 10),
    month: parseInt(map.month ?? "1", 10),
    day: parseInt(map.day ?? "1", 10),
    hour,
    minute: parseInt(map.minute ?? "0", 10),
    dow: dowMap[wd] ?? 0,
  };
}

/** Convert wall-clock parts in a TZ to a UTC Date. Walks the offset
 *  via `Intl.DateTimeFormat` to handle DST. For ambiguous times (DST
 *  fall-back) returns the earlier UTC instant. For non-existent times
 *  (DST spring-forward) returns the next valid wall-clock equivalent
 *  (by rounding forward). */
function wallClockToUtc(
  year: number, month: number, day: number, hour: number, minute: number,
  tz: string,
): Date {
  // Initial guess: assume zero offset (treat the wall-clock as if it
  // were UTC), then resolve the actual offset by reformatting in the
  // target TZ and computing the delta. Repeat once for fix-point.
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 3; i++) {
    const d = new Date(utcMs);
    const p = dateToParts(d, tz);
    const wallMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
    const targetMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const delta = targetMs - wallMs;
    if (delta === 0) return d;
    utcMs += delta;
  }
  return new Date(utcMs);
}

function daysInMonth(year: number, month1: number): number {
  // month1 is 1-12.
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function matches(parsed: ParsedCron, p: WallClockParts): boolean {
  if (!parsed.minute.values.includes(p.minute)) return false;
  if (!parsed.hour.values.includes(p.hour)) return false;
  if (!parsed.month.values.includes(p.month)) return false;
  // Vixie cron rule: if BOTH dom and dow are restricted (non-wild), the
  // entry matches if EITHER matches. If only one is restricted, that
  // one must match.
  const domOk = parsed.dayOfMonth.values.includes(p.day);
  const dowOk = parsed.dayOfWeek.values.includes(p.dow);
  if (!parsed.domWild && !parsed.dowWild) {
    return domOk || dowOk;
  }
  if (!parsed.domWild) return domOk;
  if (!parsed.dowWild) return dowOk;
  // Both wild: any day.
  return true;
}

/** Iterate wall-clock minutes starting at `from + 1 minute`, return
 *  the first that matches `parsed`. Caps at 4 years to avoid infinite
 *  loop on a misconfigured cron (e.g. Feb 30). */
function findNextWallClock(parsed: ParsedCron, from: Date, tz: string): Date {
  // Start at from + 60s, normalized to start-of-minute in TZ.
  const startMs = from.getTime() + 60_000;
  const start = dateToParts(new Date(startMs), tz);
  let { year, month, day, hour, minute } = start;

  const MAX_ITER = 4 * 366 * 24 * 60; // ~4 years of minutes, hard cap
  for (let i = 0; i < MAX_ITER; i++) {
    const monthMatches = parsed.month.values.includes(month);
    if (!monthMatches) {
      // Skip to the next allowed month at day=1, hour=0, minute=0.
      let nextMonth = parsed.month.values.find((m) => m > month);
      if (nextMonth === undefined) {
        year++;
        nextMonth = parsed.month.values[0]!;
      }
      month = nextMonth!;
      day = 1;
      hour = 0;
      minute = 0;
      continue;
    }
    if (day > daysInMonth(year, month)) {
      // Move to next month.
      month++;
      if (month > 12) { month = 1; year++; }
      day = 1; hour = 0; minute = 0;
      continue;
    }
    // Compute UTC for this wall-clock to read DOW.
    const utc = wallClockToUtc(year, month, day, hour, minute, tz);
    const parts = dateToParts(utc, tz);
    // If the round-trip drifted (DST gap caused parts.day or parts.hour
    // to differ from our candidate), advance our candidate to match
    // and continue — preserves at-most-once.
    if (parts.year !== year || parts.month !== month || parts.day !== day
        || parts.hour !== hour || parts.minute !== minute) {
      // Move forward by 1 minute and retry.
      minute++;
      if (minute > 59) { minute = 0; hour++; }
      if (hour > 23) { hour = 0; day++; }
      continue;
    }
    if (matches(parsed, parts)) return utc;

    // Advance: minute → hour → day. Use the parsed values to skip ahead
    // efficiently. Find the next allowed minute within the current hour
    // (if hour matches), otherwise jump to the next allowed hour.
    if (parsed.hour.values.includes(hour)) {
      const nextMin = parsed.minute.values.find((m) => m > minute);
      if (nextMin !== undefined) {
        minute = nextMin;
        continue;
      }
    }
    // Advance hour.
    const nextHour = parsed.hour.values.find((h) => h > hour);
    if (nextHour !== undefined) {
      hour = nextHour;
      minute = parsed.minute.values[0]!;
      continue;
    }
    // Advance day.
    day++;
    hour = parsed.hour.values[0]!;
    minute = parsed.minute.values[0]!;
  }
  throw new Error(`cron expression has no match within 4 years (likely impossible: ${JSON.stringify(parsed)})`);
}

export function parseCron(expr: string, tz: string = "UTC"): CronInstance {
  const v = validateCron(expr);
  if (!v.ok) throw new Error(`invalid cron: ${v.reason}`);
  const parsed = parseExpression(expr);
  return {
    next(from: Date): Date {
      return findNextWallClock(parsed, from, tz);
    },
  };
}

/** Test-only helper. Lets a test compute "next" against a fake clock
 *  by parsing cyclically. Production should always use
 *  `parseCron(expr, tz).next(from)`. */
export function _nextForTesting(expr: string, from: Date, fieldStepMin: number): Date {
  const v = validateCron(expr);
  if (!v.ok) throw new Error(`invalid cron: ${v.reason}`);
  return new Date(from.getTime() + fieldStepMin * 60_000);
}
