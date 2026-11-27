import { describe, expect, test, vi } from "vitest";
import {
  durationIso,
  formatBytes,
  formatCount,
  formatDuration,
  formatExact,
  formatPercent,
  formatRelative,
  toIso,
} from "@shepherdjerred/console-ui/format/format.ts";
import {
  createNowStore,
  type NowStoreEnvironment,
} from "@shepherdjerred/console-ui/format/use-now.ts";

/** Thursday 26 November 2026, 14:02:09 Pacific (UTC-8). */
const NOW = "2026-11-26T22:02:09Z";
const at = (offsetMs: number): number => Date.parse(NOW) - offsetMs;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelative", () => {
  test.each([
    [0, "just now"],
    [44 * SECOND, "just now"],
    [45 * SECOND, "45s ago"],
    [59 * SECOND, "59s ago"],
    [60 * SECOND, "1m ago"],
    [59 * MINUTE, "59m ago"],
    [60 * MINUTE, "1h ago"],
    [23 * HOUR + 59 * MINUTE, "23h ago"],
    [24 * HOUR, "1d ago"],
    [29 * DAY, "29d ago"],
    [31 * DAY, "1mo ago"],
    [200 * DAY, "6mo ago"],
    [400 * DAY, "1y ago"],
    [800 * DAY, "2y ago"],
    [-5 * MINUTE, "in 5m"],
    [-10 * SECOND, "just now"],
  ])("%d ms before now reads %s", (offset, text) => {
    expect(formatRelative(at(offset), NOW)).toBe(text);
  });

  test("accepts Date, epoch and ISO input alike", () => {
    const then = at(3 * HOUR);
    const expected = "3h ago";
    expect(formatRelative(then, NOW)).toBe(expected);
    expect(formatRelative(new Date(then), new Date(NOW))).toBe(expected);
    expect(formatRelative(toIso(then), Date.parse(NOW))).toBe(expected);
  });

  test("rejects a value that is not a moment", () => {
    expect(() => formatRelative(Number.NaN, NOW)).toThrow(RangeError);
  });
});

describe("formatExact", () => {
  test("prints Pacific time, 24-hour, whatever the host zone", () => {
    expect(formatExact(NOW)).toBe("Nov 26, 14:02 PT");
  });

  test("keeps PT through daylight saving", () => {
    expect(formatExact("2026-07-04T21:02:09Z")).toBe("Jul 4, 14:02 PT");
  });

  test("honours precision and year", () => {
    expect(formatExact(NOW, { precision: "second" })).toBe(
      "Nov 26, 14:02:09 PT",
    );
    expect(formatExact(NOW, { precision: "day" })).toBe("Nov 26, 2026");
    expect(formatExact(NOW, { year: true })).toBe("Nov 26, 2026, 14:02 PT");
  });

  test("rolls the date back across the zone boundary", () => {
    expect(formatExact("2026-11-27T03:30:00Z")).toBe("Nov 26, 19:30 PT");
    expect(formatExact("2026-11-26T07:59:00Z")).toBe("Nov 25, 23:59 PT");
  });
});

describe("formatDuration", () => {
  test.each([
    [0, "0ms"],
    [850, "850ms"],
    [1000, "1.0s"],
    [1300, "1.3s"],
    [9999, "9.9s"],
    [10_000, "10s"],
    [45 * SECOND, "45s"],
    [12 * MINUTE + 5 * SECOND, "12m 5s"],
    [2 * HOUR + 14 * MINUTE, "2h 14m"],
    [2 * HOUR, "2h"],
    [2 * HOUR + 30 * SECOND, "2h"],
    [3 * DAY + 4 * HOUR + 5 * MINUTE, "3d 4h"],
  ])("%d ms reads %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  test("rejects negative spans", () => {
    expect(() => formatDuration(-1)).toThrow(RangeError);
  });

  test("has an ISO form for <time dateTime>", () => {
    expect(durationIso(2 * HOUR + 14 * MINUTE)).toBe("PT2H14M");
  });
});

describe("formatBytes", () => {
  test.each([
    [0, "0 B"],
    [512, "512 B"],
    [1023, "1,023 B"],
    [1024, "1 KiB"],
    [1536, "1.5 KiB"],
    [14.2 * 1024 * 1024, "14.2 MiB"],
    [118 * 1024 ** 3, "118 GiB"],
    [1024 ** 4, "1 TiB"],
    [2048 * 1024 ** 4, "2,048 TiB"],
    [1024 * 1024 - 1, "1 MiB"],
  ])("%d bytes reads %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  test("rejects negative and non-finite input", () => {
    expect(() => formatBytes(-1)).toThrow(RangeError);
    expect(() => formatBytes(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("formatCount and formatPercent", () => {
  test("groups counts with commas", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1_234_567)).toBe("1,234,567");
  });

  test("formats a ratio as a percentage", () => {
    expect(formatPercent(0.9712)).toBe("97%");
    expect(formatPercent(0.9712, 1)).toBe("97.1%");
    expect(formatPercent(1, 1)).toBe("100.0%");
  });
});

const noop = (): void => {
  // Nothing to unsubscribe from.
};

function environment(): NowStoreEnvironment & {
  hide: (value: boolean) => void;
} {
  let hidden = false;
  let onChange = noop;
  return {
    clock: () => Date.now(),
    hidden: () => hidden,
    onVisibilityChange: (callback) => {
      onChange = callback;
      return noop;
    },
    hide: (value) => {
      hidden = value;
      onChange();
    },
  };
}

describe("the shared now store", () => {
  test("ticks every 30 seconds while subscribed, and stops when hidden", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.parse(NOW));
      const env = environment();
      const store = createNowStore(env);
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);
      const first = store.getSnapshot();
      vi.advanceTimersByTime(30_000);
      expect(store.getSnapshot()).toBe(first + 30_000);
      env.hide(true);
      const callsWhenHidden = listener.mock.calls.length;
      vi.advanceTimersByTime(120_000);
      expect(listener.mock.calls.length).toBe(callsWhenHidden);
      env.hide(false);
      expect(store.getSnapshot()).toBe(first + 150_000);
      unsubscribe();
      const callsAfter = listener.mock.calls.length;
      vi.advanceTimersByTime(120_000);
      expect(listener.mock.calls.length).toBe(callsAfter);
    } finally {
      vi.useRealTimers();
    }
  });
});
