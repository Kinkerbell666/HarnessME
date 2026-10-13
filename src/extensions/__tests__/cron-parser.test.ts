/**
 * Coverage for `cron.ts` (Phase 51.5.3).
 */
import { test, expect, describe } from "bun:test";
import { validateCron, parseCron } from "../cron";

describe("validateCron", () => {
  test("accepts valid 5-field expressions", () => {
    expect(validateCron("0 * * * *").ok).toBe(true);
    expect(validateCron("*/5 * * * *").ok).toBe(true);
    expect(validateCron("0 9-17 * * 1-5").ok).toBe(true);
  });

  test("rejects sub-5-min interval", () => {
    expect(validateCron("* * * * *")).toEqual({ ok: false, reason: "min-5-min-interval-required" });
    expect(validateCron("*/1 * * * *")).toEqual({ ok: false, reason: "min-5-min-interval-required" });
    expect(validateCron("*/4 * * * *")).toEqual({ ok: false, reason: "min-5-min-interval-required" });
  });

  // Trigger and briefing crons rely on validateCron alone, so every form
  // that fires more often than every 5 minutes must be refused here, not
  // only the literal `*` and `*/1..4` strings.
  test("rejects every sub-5-min form, not only the literal patterns", () => {
    for (const expr of [
      "0-59 * * * *",
      "0-59/1 * * * *",
      "1,2,3 * * * *",
      "* * * * 1",
      "* 9 * * *",
      "0,59 0,23 * * *",
    ]) {
      expect(validateCron(expr)).toEqual({ ok: false, reason: "min-5-min-interval-required" });
    }
  });

  test("accepts sparse schedules with a gap of 5 minutes or more", () => {
    for (const expr of ["0,5 * * * *", "2 * * * *", "0 0 29 2 *", "0 0 31 12 *"]) {
      expect(validateCron(expr).ok).toBe(true);
    }
  });

  test("rejects @-shorthand expressions", () => {
    const r = validateCron("@hourly");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("shorthand");
  });

  test("rejects expressions with wrong field count", () => {
    expect(validateCron("0 0").ok).toBe(false);
    expect(validateCron("0 0 0 0 0 0").ok).toBe(false);
  });

  test("rejects empty / non-string", () => {
    expect(validateCron("").ok).toBe(false);
    expect(validateCron("   ").ok).toBe(false);
  });

  test("rejects malformed range syntax via Bun.cron.parse", () => {
    // The literal regex permits 5 fields, so this must reach Bun.cron.parse.
    const r = validateCron("99 * * * *");
    expect(r.ok).toBe(false);
  });
});

describe("parseCron.next", () => {
  test("returns a Date strictly after `from`", () => {
    const cron = parseCron("0 * * * *"); // every hour
    const from = new Date("2026-05-08T10:30:00Z");
    const n = cron.next(from);
    expect(n.getTime()).toBeGreaterThan(from.getTime());
  });

  test("throws for invalid expression", () => {
    expect(() => parseCron("* * * * *")).toThrow();
  });

  test("UTC: next minute of `0 * * * *` from 10:30 is 11:00", () => {
    const cron = parseCron("0 * * * *", "UTC");
    const from = new Date("2026-05-08T10:30:00Z");
    const n = cron.next(from);
    expect(n.toISOString()).toBe("2026-05-08T11:00:00.000Z");
  });

  test("UTC: `30 14 * * *` next from 14:00 is same day 14:30", () => {
    const cron = parseCron("30 14 * * *", "UTC");
    const from = new Date("2026-05-08T14:00:00Z");
    const n = cron.next(from);
    expect(n.toISOString()).toBe("2026-05-08T14:30:00.000Z");
  });
});

describe("parseCron.next — DST + TZ awareness", () => {
  test("America/New_York: spring-forward 2026-03-08 — `30 2 * * *` rolls over the gap", () => {
    // On 2026-03-08, 02:00 → 03:00 in America/New_York (DST forward).
    // Wall-clock 02:30 doesn't exist that day. The next fire at-or-
    // after 2026-03-08 01:00 EST should land on 2026-03-09 02:30 EST
    // (the day after — when 02:30 exists again).
    const cron = parseCron("30 2 * * *", "America/New_York");
    // 2026-03-08T06:00:00Z = 01:00 EST that day.
    const from = new Date("2026-03-08T06:00:00Z");
    const n = cron.next(from);
    // The cron fires at 02:30 wall-clock in NY. Since 02:30 doesn't
    // exist on 2026-03-08, we expect the next occurrence — 03-09.
    // 2026-03-09 02:30 EDT = 06:30 UTC.
    expect(n.toISOString()).toBe("2026-03-09T06:30:00.000Z");
  });

  test("America/New_York: fall-back 2026-11-01 — `30 1 * * *` picks first occurrence", () => {
    // On 2026-11-01, 02:00 EDT → 01:00 EST (fall-back). Wall-clock
    // 01:30 happens twice. The cron should fire at the FIRST
    // occurrence — 01:30 EDT = 05:30 UTC.
    const cron = parseCron("30 1 * * *", "America/New_York");
    const from = new Date("2026-11-01T04:00:00Z"); // before the ambiguity
    const n = cron.next(from);
    // First 01:30 wall-clock on 2026-11-01 is 01:30 EDT = 05:30 UTC.
    expect(n.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  test("Asia/Kolkata (UTC+05:30): `0 9 * * *` from midnight UTC → 03:30 UTC same day", () => {
    // 09:00 IST = 03:30 UTC. India has no DST, so the 30-minute
    // offset must come through cleanly.
    const cron = parseCron("0 9 * * *", "Asia/Kolkata");
    const from = new Date("2026-05-08T00:00:00Z");
    const n = cron.next(from);
    expect(n.toISOString()).toBe("2026-05-08T03:30:00.000Z");
  });

  test("UTC vs America/New_York: `0 12 * * *` produces different UTC times", () => {
    const utc = parseCron("0 12 * * *", "UTC");
    const ny = parseCron("0 12 * * *", "America/New_York");
    const from = new Date("2026-06-15T00:00:00Z");
    const utcNext = utc.next(from);
    const nyNext = ny.next(from);
    expect(utcNext.toISOString()).toBe("2026-06-15T12:00:00.000Z");
    // 12:00 EDT = 16:00 UTC.
    expect(nyNext.toISOString()).toBe("2026-06-15T16:00:00.000Z");
  });
});
