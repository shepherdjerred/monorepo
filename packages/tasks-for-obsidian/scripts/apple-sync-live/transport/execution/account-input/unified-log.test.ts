import { expect, test } from "vitest";
import { macUnifiedLogQuery } from "./unified-log";

test("log query uses the guest-accepted UTC syntax and encloses the precise interval", () => {
  const start = Date.parse("2026-10-29T00:00:35Z") / 1000 + 0.831738;
  const end = Date.parse("2026-10-29T00:00:43.034Z");
  const query = macUnifiedLogQuery(123, start, end);
  expect(query.interval).toEqual({
    startUnixMilliseconds: start * 1000,
    endUnixMilliseconds: end,
  });
  expect(query.argv).toEqual([
    "/usr/bin/log",
    "show",
    "--info",
    "--debug",
    "--style",
    "ndjson",
    "--start",
    "2026-10-29 00:00:35+0000",
    "--end",
    "2026-10-29 00:00:44+0000",
    "--predicate",
    "processIdentifier == 123",
  ]);
});

test.each([
  [
    "2024-02-29T23:59:59.999Z",
    "2024-03-01T00:00:00.001Z",
    "2024-02-29 23:59:59+0000",
    "2024-03-01 00:00:01+0000",
  ],
  [
    "2026-11-01T01:59:59-0700",
    "2026-11-01T01:00:00-0800",
    "2026-11-01 08:59:59+0000",
    "2026-11-01 09:00:00+0000",
  ],
  [
    "2026-10-29T00:00:35Z",
    "2026-10-29T00:00:35Z",
    "2026-10-29 00:00:35+0000",
    "2026-10-29 00:00:35+0000",
  ],
])(
  "UTC rounding retains coverage across calendar/timezone edges (%s)",
  (start, end, lower, upper) => {
    const begin = Date.parse(start),
      finish = Date.parse(end);
    const query = macUnifiedLogQuery(123, begin / 1000, finish);
    expect(query.argv[7]).toBe(lower);
    expect(query.argv[9]).toBe(upper);
    const lowerMS = Date.parse(lower.replace(" ", "T").replace("+0000", "Z"));
    const upperMS = Date.parse(upper.replace(" ", "T").replace("+0000", "Z"));
    expect(begin - lowerMS).toBeGreaterThanOrEqual(0);
    expect(begin - lowerMS).toBeLessThan(1000);
    expect(upperMS - finish).toBeGreaterThanOrEqual(0);
    expect(upperMS - finish).toBeLessThan(1000);
  },
);

test.each([
  [0, 999, 1_005_015],
  [1.5, 999, 1_005_015],
  [2_147_483_648, 999, 1_005_015],
  [123, Number.NaN, 1_005_015],
  [123, Number.POSITIVE_INFINITY, 1_005_015],
  [123, -1, 1_005_015],
  [123, 999, Number.NaN],
  [123, 999, Number.POSITIVE_INFINITY],
  [123, 999, 998_999],
  [123, 999, 1_005_015.5],
  [123, 999, 1e16],
])(
  "invalid PID/interval rejects before invoking a process (%s/%s/%s)",
  (pid, start, end) => {
    expect(() => macUnifiedLogQuery(pid, start, end)).toThrow();
  },
);
