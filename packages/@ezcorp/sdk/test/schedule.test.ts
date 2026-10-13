// schedule.test.ts — 100% line coverage for runtime/schedule.ts
//
// `Schedule` registers per-cron handlers in a module-level Map and lazily
// installs ONE `ezcorp/schedule-fire` receiver on the singleton channel.
// `fireNow` is a plain reverse-RPC.
//
// Module-state gotcha: `receiverInstalled` latches true for the whole
// process, and the singleton channel persists across `__resetChannelForTests`
// only as a fresh instance — but `installReceiver` won't re-run once the
// flag is set. So we capture the receiver closure exactly once, on the
// VERY FIRST `on()` call, by spying `onRequest` before that call and
// stashing the handler. All later tests reuse the captured closure (which
// reads the live module-level `handlers` Map) to simulate host fire frames.

import {
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";

import {
  Schedule,
  type ScheduleHandlerContext,
} from "../src/runtime/schedule";
import {
  __resetChannelForTests,
  getChannel,
  type HostChannel,
} from "../src/runtime/channel";

// Captured once — the receiver closure the SDK installs for schedule-fire.
let receiver: ((p: unknown) => Promise<unknown> | unknown) | undefined;

beforeAll(() => {
  const ch: HostChannel = getChannel();
  const onReqSpy = spyOn(ch, "onRequest");
  onReqSpy.mockImplementation(((method: string, handler: (p: unknown) => unknown) => {
    if (method === "ezcorp/schedule-fire") receiver = handler;
  }) as HostChannel["onRequest"]);
  // First on() across the process → installReceiver() fires onRequest,
  // which our spy intercepts and stashes.
  new Schedule().on("__capture__", () => {
    throw new Error("capture-only handler should never fire");
  });
  onReqSpy.mockRestore();
});

afterEach(() => {
  __resetChannelForTests();
});

function makeCtx(
  overrides: Partial<ScheduleHandlerContext> = {},
): ScheduleHandlerContext {
  return {
    cron: "0 9 * * *",
    scheduledAt: "2026-01-01T09:00:00.000Z",
    firedAt: "2026-01-01T09:00:01.000Z",
    fireId: "fire-1",
    catchUp: false,
    retry: false,
    attempt: 1,
    ...overrides,
  };
}

describe("Schedule.on + receiver dispatch", () => {
  test("receiver closure was captured on first install", () => {
    expect(receiver).toBeDefined();
  });

  test("registered cron handler fires with the host ctx", async () => {
    const seen: ScheduleHandlerContext[] = [];
    new Schedule().on("0 9 * * *", (ctx) => {
      seen.push(ctx);
    });
    const ctx = makeCtx();
    await receiver!(ctx);
    expect(seen).toEqual([ctx]);
  });

  test("async handler is awaited", async () => {
    let resolved = false;
    new Schedule().on("5 * * * *", async () => {
      await new Promise((r) => setTimeout(r, 5));
      resolved = true;
    });
    await receiver!(makeCtx({ cron: "5 * * * *" }));
    expect(resolved).toBe(true);
  });

  test("unregistered cron is silently dropped (no throw, returns undefined)", async () => {
    const result = await receiver!(makeCtx({ cron: "59 23 * * * unmatched" }));
    expect(result).toBeUndefined();
  });

  test("last on() for a cron wins (Map overwrite semantics)", async () => {
    const calls: string[] = [];
    const schedule = new Schedule();
    schedule.on("0 12 * * *", () => { calls.push("first"); });
    schedule.on("0 12 * * *", () => { calls.push("second"); });
    await receiver!(makeCtx({ cron: "0 12 * * *" }));
    expect(calls).toEqual(["second"]);
  });

  test("on() after the receiver is installed does not re-register (idempotent)", async () => {
    // Spy onRequest now; a fresh on() must NOT call it again because
    // receiverInstalled already latched true on the first install.
    const ch: HostChannel = getChannel();
    const onReqSpy = spyOn(ch, "onRequest");
    new Schedule().on("0 6 * * *", () => {});
    expect(onReqSpy).not.toHaveBeenCalled();
    onReqSpy.mockRestore();
  });
});

describe("Schedule.fireNow", () => {
  test("sends { action:'fire-now', cron } over ezcorp/schedule", async () => {
    const ch: HostChannel = getChannel();
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const reqSpy = spyOn(ch, "request");
    reqSpy.mockImplementation(
      (async (method: string, params: unknown) => {
        calls.push({
          method,
          params: (params ?? {}) as Record<string, unknown>,
        });
        return undefined;
      }) as HostChannel["request"],
    );
    await new Schedule().fireNow("0 9 * * *");
    expect(calls[0]?.method).toBe("ezcorp/schedule");
    expect(calls[0]?.params).toEqual({ action: "fire-now", cron: "0 9 * * *" });
    reqSpy.mockRestore();
  });
});
