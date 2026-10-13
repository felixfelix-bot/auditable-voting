/**
 * Deterministic time control for the E2E harness.
 *
 * The voting rounds in this app are windowed by time (`openAt`, `closeAt`,
 * `finalizationGraceSeconds`), and the client also drives release work off
 * `setTimeout` / `setInterval` and `Date.now()`. A harness that waits for real
 * time would need `sleep()` calls and would be non-reproducible, so instead the
 * harness *owns* the clock:
 *
 * - `installFakeClock()` patches `Date`, `Date.now`, `setTimeout`,
 *   `setInterval` and the matching clear functions in the current process.
 * - `pageClockInitScript()` returns a self-contained script for
 *   `page.addInitScript(...)`, which installs the same clock in a browser page
 *   *before* the app boots.
 *
 * Time only moves when the harness moves it: `set(seconds)` or
 * `advance(seconds)`. `advance` fires every timer that becomes due, in
 * (due time, insertion order), so interval-driven release work runs without any
 * wall-clock wait. `flush()` drains microtasks between clock steps.
 *
 * No production code imports this module; it is harness-side only. It never
 * changes behaviour unless explicitly installed.
 */

/**
 * What the fake clock patches when installed.
 *
 * `timers: false` (the Node default) patches `Date` only. That is the safe mode
 * for driving the app's publish/query code: the client's transport uses
 * `setTimeout` for its own publish/query deadlines, and freezing those timers
 * would deadlock `nostr-tools` rather than make the test deterministic.
 *
 * `timers: true` additionally patches `setTimeout`/`setInterval` so that
 * `advance()` fires scheduled work instantly. This is the mode for tests whose
 * subject IS the scheduling (windowed release tasks), and the mode the browser
 * page script always uses.
 */
export type ClockInstallOptions = {
  timers?: boolean;
};

export type FakeClock = {
  /** Install the fake clock over the globals in this process. */
  install(options?: ClockInstallOptions): void;
  /** True when timers (`setTimeout`/`setInterval`) are patched. */
  readonly timersPatched: boolean;
  /** Remove the fake clock and restore the real globals. */
  restore(): void;
  /** Current virtual time in milliseconds since the unix epoch. */
  nowMs(): number;
  /** Current virtual time in whole seconds since the unix epoch. */
  nowSeconds(): number;
  /** Jump to an absolute unix time (seconds). Fires any timers that fall due. */
  set(seconds: number): void;
  /** Jump to an absolute unix time in milliseconds. */
  setMs(ms: number): void;
  /** Move the clock forwards. Fires every timer that falls due, in order. */
  advance(seconds: number): void;
  advanceMs(ms: number): void;
  /** Number of timers currently scheduled (diagnostics / assertions). */
  pendingTimers(): number;
  /** Drain the microtask queue. */
  flush(): Promise<void>;
  /** True while the fake clock is installed. */
  readonly installed: boolean;
  /** Real elapsed milliseconds since the clock was created. */
  realElapsedMs(): number;
};

type ScheduledTask = {
  id: number;
  dueAt: number;
  intervalMs: number | null;
  callback: (...args: unknown[]) => void;
  args: unknown[];
};

const MAX_TIMER_FIRINGS_PER_ADVANCE = 100_000;

/** Deterministic clock + timer scheduler for the current process. */
export function createFakeClock(startSeconds: number): FakeClock {
  const realDate = Date;
  const realDateNow = Date.now.bind(Date);
  const realSetTimeout = globalThis.setTimeout.bind(globalThis);
  const realClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const realSetInterval = globalThis.setInterval.bind(globalThis);
  const realClearInterval = globalThis.clearInterval.bind(globalThis);
  const startedAtRealMs = realDateNow();

  let virtualMs = startSeconds * 1000;
  let installed = false;
  let timersPatched = false;
  let nextTimerId = 1;
  const tasks = new Map<number, ScheduledTask>();

  const makeDate = () => {
    class HarnessDate extends realDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(virtualMs);
        } else {
          super(...(args as [number | string | Date]));
        }
      }

      static override now(): number {
        return virtualMs;
      }
    }
    return HarnessDate as DateConstructor;
  };

  const dueTasks = (targetMs: number): ScheduledTask[] => {
    const due: ScheduledTask[] = [];
    for (const task of tasks.values()) {
      if (task.dueAt <= targetMs) {
        due.push(task);
      }
    }
    return due.sort((left, right) => (left.dueAt - right.dueAt) || (left.id - right.id));
  };

  const runUntil = (targetMs: number) => {
    let fired = 0;
    for (;;) {
      const [next] = dueTasks(targetMs);
      if (!next) {
        break;
      }
      fired += 1;
      if (fired > MAX_TIMER_FIRINGS_PER_ADVANCE) {
        throw new Error("Fake clock fired too many timers in one advance; suspected zero-delay interval loop.");
      }
      virtualMs = next.dueAt;
      if (next.intervalMs === null) {
        tasks.delete(next.id);
      } else {
        next.dueAt = virtualMs + Math.max(1, next.intervalMs);
      }
      next.callback(...next.args);
    }
    virtualMs = targetMs;
  };

  const clock: FakeClock = {
    get installed() {
      return installed;
    },
    get timersPatched() {
      return timersPatched;
    },
    install(options: ClockInstallOptions = {}) {
      if (installed && (timersPatched || options.timers !== true)) {
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = globalThis as any;
      if (!installed) {
        installed = true;
        g.Date = makeDate();
      }
      if (options.timers !== true) {
        return;
      }
      timersPatched = true;
      g.setTimeout = (callback: (...args: unknown[]) => void, delayMs?: number, ...args: unknown[]) => {
        const id = nextTimerId++;
        tasks.set(id, {
          id,
          dueAt: virtualMs + Math.max(0, Number(delayMs ?? 0) || 0),
          intervalMs: null,
          callback: typeof callback === "function" ? callback : () => undefined,
          args,
        });
        return id;
      };
      g.clearTimeout = (id?: number) => {
        if (typeof id === "number") {
          tasks.delete(id);
        }
      };
      g.setInterval = (callback: (...args: unknown[]) => void, delayMs?: number, ...args: unknown[]) => {
        const period = Math.max(1, Number(delayMs ?? 1) || 1);
        const id = nextTimerId++;
        tasks.set(id, {
          id,
          dueAt: virtualMs + period,
          intervalMs: period,
          callback: typeof callback === "function" ? callback : () => undefined,
          args,
        });
        return id;
      };
      g.clearInterval = (id?: number) => {
        if (typeof id === "number") {
          tasks.delete(id);
        }
      };
    },
    restore() {
      if (!installed) {
        return;
      }
      installed = false;
      timersPatched = false;
      tasks.clear();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = globalThis as any;
      g.Date = realDate;
      g.setTimeout = realSetTimeout;
      g.clearTimeout = realClearTimeout;
      g.setInterval = realSetInterval;
      g.clearInterval = realClearInterval;
    },
    nowMs() {
      return virtualMs;
    },
    nowSeconds() {
      return Math.floor(virtualMs / 1000);
    },
    set(seconds: number) {
      runUntil(seconds * 1000);
    },
    setMs(ms: number) {
      runUntil(ms);
    },
    advance(seconds: number) {
      runUntil(virtualMs + seconds * 1000);
    },
    advanceMs(ms: number) {
      runUntil(virtualMs + ms);
    },
    pendingTimers() {
      return tasks.size;
    },
    async flush() {
      // Uses the *real* timer so draining works while the fake clock is installed.
      for (let index = 0; index < 4; index += 1) {
        await new Promise<void>((resolve) => {
          realSetTimeout(resolve, 0);
        });
      }
    },
    realElapsedMs() {
      return realDateNow() - startedAtRealMs;
    },
  };

  return clock;
}

/**
 * Self-contained clock installer for `page.addInitScript()`.
 *
 * Declared as a plain script string (not a stringified function) so it survives
 * bundling/transpilation unchanged. It exposes `window.__AV_CLOCK__` with the
 * same surface as `FakeClock`, minus `install`/`restore` (it installs itself
 * immediately) and plus nothing else. It is a no-op the app never observes
 * until a test moves the clock, because time starts real and only changes when
 * `set`/`advance` is called.
 */
export const PAGE_CLOCK_INIT_SCRIPT = `(() => {
  if (window.__AV_CLOCK__) { return; }
  const RealDate = Date;
  const realDateNow = Date.now.bind(Date);
  const realSetTimeout = window.setTimeout.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  const realSetInterval = window.setInterval.bind(window);
  const realClearInterval = window.clearInterval.bind(window);
  let virtualMs = realDateNow();
  let nextTimerId = 1;
  const tasks = new Map();
  class HarnessDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) { super(virtualMs); } else { super(...args); }
    }
    static now() { return virtualMs; }
  }
  function dueTasks(targetMs) {
    const due = [];
    for (const task of tasks.values()) { if (task.dueAt <= targetMs) { due.push(task); } }
    return due.sort((left, right) => (left.dueAt - right.dueAt) || (left.id - right.id));
  }
  function runUntil(targetMs) {
    let fired = 0;
    for (;;) {
      const next = dueTasks(targetMs)[0];
      if (!next) { break; }
      fired += 1;
      if (fired > 100000) { throw new Error("Fake clock fired too many timers in one advance."); }
      virtualMs = next.dueAt;
      if (next.intervalMs === null) { tasks.delete(next.id); } else { next.dueAt = virtualMs + Math.max(1, next.intervalMs); }
      try { next.callback(...next.args); } catch (error) { realSetTimeout(() => { throw error; }, 0); }
    }
    virtualMs = targetMs;
  }
  window.Date = HarnessDate;
  window.setTimeout = (callback, delayMs, ...args) => {
    const id = nextTimerId++;
    tasks.set(id, { id, dueAt: virtualMs + Math.max(0, Number(delayMs ?? 0) || 0), intervalMs: null, callback, args });
    return id;
  };
  window.clearTimeout = (id) => { if (typeof id === "number") { tasks.delete(id); } };
  window.setInterval = (callback, delayMs, ...args) => {
    const period = Math.max(1, Number(delayMs ?? 1) || 1);
    const id = nextTimerId++;
    tasks.set(id, { id, dueAt: virtualMs + period, intervalMs: period, callback, args });
    return id;
  };
  window.clearInterval = (id) => { if (typeof id === "number") { tasks.delete(id); } };
  window.__AV_CLOCK__ = {
    nowMs: () => virtualMs,
    nowSeconds: () => Math.floor(virtualMs / 1000),
    set: (seconds) => runUntil(seconds * 1000),
    setMs: (ms) => runUntil(ms),
    advance: (seconds) => runUntil(virtualMs + seconds * 1000),
    advanceMs: (ms) => runUntil(virtualMs + ms),
    pendingTimers: () => tasks.size,
    flush: async () => { for (let index = 0; index < 4; index += 1) { await new Promise((resolve) => realSetTimeout(resolve, 0)); } },
    restore: () => {
      tasks.clear();
      window.Date = RealDate;
      window.setTimeout = realSetTimeout;
      window.clearTimeout = realClearTimeout;
      window.setInterval = realSetInterval;
      window.clearInterval = realClearInterval;
      delete window.__AV_CLOCK__;
    },
  };
})();`;
