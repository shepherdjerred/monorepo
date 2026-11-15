import { describe, expect, it } from "vitest";
import { COCOA_EPOCH_OFFSET_SECONDS } from "#lib/brim/cache.ts";
import type { UsageSnapshot, UsageWindow } from "#lib/brim/cache.ts";
import { computePace, windowDurationSeconds } from "#lib/brim/pace.ts";
import {
  ageString,
  countdown,
  formatPercent,
  isFiveHourWindow,
  isMonthlyWindow,
  isWeeklyWindow,
  rankSnapshots,
} from "#lib/brim/rank.ts";

const NOW_MS = Date.UTC(2026, 8, 21, 12, 0, 0);
const NOW_COCOA = NOW_MS / 1000 - COCOA_EPOCH_OFFSET_SECONDS;

function win(
  label: string,
  kind: Record<string, unknown>,
  used: number | null,
  resetInDays: number | null,
): UsageWindow {
  return {
    id: label,
    label,
    kind,
    usedPercent: used,
    resetAt: resetInDays === null ? null : NOW_COCOA + resetInDays * 86_400,
    sourceTimestamp: NOW_COCOA,
  };
}

function snapshot(
  provider: string,
  windows: UsageWindow[],
  freshness?: Record<string, unknown>,
): UsageSnapshot {
  return {
    provider,
    accountLabel: null,
    windows,
    resets: [],
    resetErrorMessage: null,
    notes: [],
    sourceTimestamp: NOW_COCOA,
    freshness: freshness ?? { current: {} },
  };
}

describe("window selectors", () => {
  it("treats exact weekly kinds and weekly labels as weekly", () => {
    expect(isWeeklyWindow(win("Weekly", { weekly: {} }, 10, 3))).toBe(true);
    expect(
      isWeeklyWindow(
        win("Gemini weekly", { modelScoped: { model: "Gemini" } }, 10, 3),
      ),
    ).toBe(true);
    expect(isWeeklyWindow(win("5-hour", { rolling: {} }, 10, 1))).toBe(false);
    expect(isWeeklyWindow(win("Cursor Models", { monthly: {} }, 10, 20))).toBe(
      false,
    );
  });

  it("treats exact monthly kinds as monthly", () => {
    expect(isMonthlyWindow(win("Cursor Models", { monthly: {} }, 86, 20))).toBe(
      true,
    );
    expect(isMonthlyWindow(win("Weekly", { weekly: {} }, 10, 3))).toBe(false);
  });

  it("treats 5-hour labels as five-hour windows", () => {
    expect(isFiveHourWindow(win("5-hour", { rolling: {} }, 10, 1))).toBe(true);
    expect(
      isFiveHourWindow(
        win("Gemini 5-hour", { modelScoped: { model: "Gemini" } }, 0, 1),
      ),
    ).toBe(true);
    expect(isFiveHourWindow(win("Weekly", { weekly: {} }, 10, 3))).toBe(false);
  });
});

function hoursWin(
  label: string,
  kind: Record<string, unknown>,
  used: number,
  resetInHours: number,
): UsageWindow {
  return {
    ...win(label, kind, used, null),
    resetAt: NOW_COCOA + resetInHours * 3600,
  };
}

describe("windowDurationSeconds", () => {
  it("uses a rolling window's own duration", () => {
    expect(
      windowDurationSeconds(
        win("5-hour", { rolling: { durationSeconds: 18_000 } }, 10, 1),
      ),
    ).toBe(18_000);
    expect(
      windowDurationSeconds(
        win("Daily", { rolling: { durationSeconds: 86_400 } }, 10, 1),
      ),
    ).toBe(86_400);
  });

  it("reads the period from per-model labels", () => {
    const gemini = { modelScoped: { model: "Gemini" } };
    expect(windowDurationSeconds(win("Gemini 5-hour", gemini, 10, 1))).toBe(
      18_000,
    );
    expect(windowDurationSeconds(win("Gemini weekly", gemini, 10, 1))).toBe(
      7 * 86_400,
    );
    expect(windowDurationSeconds(win("Gemini", gemini, 10, 1))).toBe(null);
    expect(
      windowDurationSeconds(win("Policy", { entitlement: {} }, 0, 1)),
    ).toBe(null);
  });

  it("uses the calendar month before a monthly reset", () => {
    const window = (ms: number): UsageWindow => ({
      ...win("Cursor Models", { monthly: {} }, 10, null),
      resetAt: ms / 1000 - COCOA_EPOCH_OFFSET_SECONDS,
    });
    // Oct 22 -> Sep 22 is 30 days; Mar 31 clamps to Feb 28 (2027 is not a leap year).
    expect(windowDurationSeconds(window(Date.UTC(2026, 9, 22)))).toBe(
      30 * 86_400,
    );
    expect(windowDurationSeconds(window(Date.UTC(2027, 2, 31)))).toBe(
      31 * 86_400,
    );
    expect(windowDurationSeconds(window(Date.UTC(2027, 0, 15)))).toBe(
      31 * 86_400,
    );
    expect(
      windowDurationSeconds(win("Cursor Models", { monthly: {} }, 10, null)),
    ).toBe(null);
  });
});

describe("computePace", () => {
  it("reports ahead when remaining burn exceeds the even pace", () => {
    // 90% remaining with 2 days left: 45%/d vs ~14.3%/d even.
    const window = win("Weekly", { weekly: {} }, 10, 2);
    expect(computePace(window, NOW_COCOA)).toBe("ahead");
  });

  it("reports behind when remaining burn trails the even pace", () => {
    // 10% remaining with 2 days left: 5%/d vs ~14.3%/d even.
    const window = win("Weekly", { weekly: {} }, 90, 2);
    expect(computePace(window, NOW_COCOA)).toBe("behind");
  });

  it("paces Antigravity's per-model windows by their label", () => {
    const gemini = { modelScoped: { model: "Gemini" } };
    expect(computePace(win("Gemini weekly", gemini, 10, 2), NOW_COCOA)).toBe(
      "ahead",
    );
    // 20% left with 4 of 5 hours to go: 5%/h vs 20%/h even.
    expect(
      computePace(hoursWin("Gemini 5-hour", gemini, 80, 4), NOW_COCOA),
    ).toBe("behind");
  });

  it("paces 5-hour rolling windows", () => {
    // 50% left with 2.5 of 5 hours to go is an even split.
    expect(
      computePace(
        hoursWin("5-hour", { rolling: { durationSeconds: 18_000 } }, 50, 2.5),
        NOW_COCOA,
      ),
    ).toBe("on-pace");
  });

  it("reports monthly pace over the calendar month", () => {
    // 90% remaining with 20 days left: 4.5%/d vs ~3.3%/d even.
    expect(
      computePace(win("Cursor Models", { monthly: {} }, 10, 20), NOW_COCOA),
    ).toBe("ahead");
    // 14% remaining with 9 days left: ~1.6%/d vs ~3.3%/d even.
    expect(
      computePace(win("Cursor Models", { monthly: {} }, 86, 9), NOW_COCOA),
    ).toBe("behind");
  });

  it("returns null for windows without a duration", () => {
    expect(computePace(win("Credits", { credits: {} }, 10, 2), NOW_COCOA)).toBe(
      null,
    );
  });

  it("returns null for resets outside the (0, duration] range", () => {
    expect(computePace(win("Weekly", { weekly: {} }, 10, 0), NOW_COCOA)).toBe(
      null,
    );
    expect(computePace(win("Weekly", { weekly: {} }, 10, 8), NOW_COCOA)).toBe(
      null,
    );
    // Sep 21 + 31 days is Oct 22, whose month began Sep 22: 30 days.
    expect(
      computePace(win("Cursor Models", { monthly: {} }, 10, 31), NOW_COCOA),
    ).toBe(null);
  });
});

describe("rankSnapshots", () => {
  it("sorts by lowest budget usage first across window kinds", () => {
    const result = rankSnapshots(
      [
        snapshot("cursor", [win("Cursor Models", { monthly: {} }, 40, 20)]),
        snapshot("codex", [win("Weekly", { weekly: {} }, 5, 3)]),
        snapshot("grok", [win("Weekly", { weekly: {} }, 50, 3)]),
      ],
      { nowMs: NOW_MS },
    );
    expect(result.ranked.map((entry) => entry.provider)).toEqual([
      "codex",
      "cursor",
      "grok",
    ]);
    const cursor = result.ranked.find((entry) => entry.provider === "cursor");
    expect(cursor?.budgetKind).toBe("monthly");
    expect(cursor?.budgetUsed).toBe(40);
  });

  it("carries each provider's plan, available or not", () => {
    const result = rankSnapshots(
      [
        {
          ...snapshot("cursor", [
            win("Cursor Models", { monthly: {} }, 40, 20),
          ]),
          plan: { name: "Pro", monthlyCostUSD: 20 },
        },
        {
          ...snapshot("kimi", [win("Monthly", { monthly: {} }, 40, 20)], {
            stale: { reason: "Kimi Code credentials expired." },
          }),
          plan: { name: "Pro" },
        },
        snapshot("codex", [win("Weekly", { weekly: {} }, 5, 3)]),
      ],
      { nowMs: NOW_MS },
    );
    const cursor = result.ranked.find((entry) => entry.provider === "cursor");
    expect(cursor?.planName).toBe("Pro");
    expect(cursor?.planMonthlyCostUSD).toBe(20);
    const kimi = result.unavailable.find((entry) => entry.provider === "kimi");
    expect(kimi?.planName).toBe("Pro");
    expect(kimi?.planMonthlyCostUSD).toBeNull();
    const codex = result.ranked.find((entry) => entry.provider === "codex");
    expect(codex?.planName).toBeNull();
  });

  it("moves 5-hour-exhausted providers to unavailable", () => {
    const result = rankSnapshots(
      [
        snapshot("claude-code", [
          win("5-hour", { rolling: { durationSeconds: 18_000 } }, 100, 0.1),
          win("Weekly", { weekly: {} }, 10, 3),
        ]),
        snapshot("grok", [win("Weekly", { weekly: {} }, 50, 3)]),
      ],
      { nowMs: NOW_MS },
    );
    expect(result.ranked.map((entry) => entry.provider)).toEqual(["grok"]);
    expect(result.unavailable.map((entry) => entry.provider)).toEqual([
      "claude-code",
    ]);
    expect(result.unavailable[0]?.reason).toContain("5-hour exhausted");
  });

  it("lets providers without a 5-hour window through the gate", () => {
    const result = rankSnapshots(
      [snapshot("codex", [win("Weekly", { weekly: {} }, 98, 3)])],
      { nowMs: NOW_MS },
    );
    expect(result.ranked.map((entry) => entry.provider)).toEqual(["codex"]);
  });

  it("prefers ahead pacing over behind pacing at equal budget usage", () => {
    const result = rankSnapshots(
      [
        snapshot("grok", [win("Weekly", { weekly: {} }, 50, 6)]),
        snapshot("muse", [win("Weekly", { weekly: {} }, 50, 1)]),
      ],
      { nowMs: NOW_MS },
    );
    // Grok: 50% left over 6d = behind; Muse: 50% left over 1d = ahead.
    expect(result.ranked[0]?.provider).toBe("muse");
  });

  it("ranks a monthly budget by its tightest pool with pacing", () => {
    // The roomiest pool must not mask an exhausted one: the spawned
    // session cannot choose which pool it consumes.
    const result = rankSnapshots(
      [
        snapshot("cursor", [
          win("Cursor Models", { monthly: {} }, 86, 9),
          win("Other Models", { monthly: {} }, 100, 9),
        ]),
      ],
      { nowMs: NOW_MS },
    );
    expect(result.ranked.map((entry) => entry.provider)).toEqual(["cursor"]);
    expect(result.ranked[0]?.budgetKind).toBe("monthly");
    expect(result.ranked[0]?.budgetUsed).toBe(100);
    expect(result.ranked[0]?.pace).toBe("behind");
    expect(result.ranked[0]?.budgetResetsIn).toBe("9d");
  });

  it("shows providers without a weekly or monthly budget separately", () => {
    const result = rankSnapshots(
      [
        snapshot("kimi", [
          win("Shared usage", { providerDefined: {} }, 28, 3),
          win("5-hour", { rolling: { durationSeconds: 18_000 } }, 0, 0.1),
        ]),
        snapshot("grok", [win("Weekly", { weekly: {} }, 31, 3)]),
      ],
      { nowMs: NOW_MS },
    );
    expect(result.ranked.map((entry) => entry.provider)).toEqual(["grok"]);
    expect(result.other.map((entry) => entry.provider)).toEqual(["kimi"]);
    expect(result.other[0]?.fallbackWindow).toEqual(["Shared usage", 28]);
  });

  it("marks stale snapshots unavailable with the provider reason", () => {
    const result = rankSnapshots(
      [
        snapshot(
          "kimi",
          [win("Shared usage", { providerDefined: {} }, 28, 3)],
          {
            stale: { reason: "Cached data; waiting for a provider refresh." },
          },
        ),
      ],
      { nowMs: NOW_MS },
    );
    expect(result.unavailable.map((entry) => entry.provider)).toEqual(["kimi"]);
    expect(result.unavailable[0]?.reason).toContain("stale");
  });

  it("ranks Antigravity by its tightest weekly bucket", () => {
    const result = rankSnapshots(
      [
        snapshot("antigravity", [
          win("Gemini weekly", { modelScoped: { model: "Gemini" } }, 15.8, 3),
          win(
            "Claude/GPT weekly",
            { modelScoped: { model: "Claude/GPT" } },
            0,
            6,
          ),
        ]),
      ],
      { nowMs: NOW_MS },
    );
    expect(result.ranked[0]?.budgetUsed).toBe(15.8);
  });

  it("marks snapshots with no usable usage window unavailable", () => {
    const result = rankSnapshots(
      [
        snapshot("kimi", []),
        snapshot("cursor", [
          win("5-hour", { rolling: { durationSeconds: 18_000 } }, 12, 0.1),
        ]),
      ],
      { nowMs: NOW_MS },
    );
    expect(result.ranked).toEqual([]);
    expect(result.other).toEqual([]);
    expect(result.unavailable.map((entry) => entry.provider)).toEqual([
      "cursor",
      "kimi",
    ]);
    expect(result.unavailable[0]?.reason).toBe("no usable usage window");
  });

  it("marks snapshots whose percentages are all missing unavailable", () => {
    const result = rankSnapshots(
      [
        snapshot("kimi", [
          win("Shared usage", { providerDefined: {} }, null, 3),
        ]),
      ],
      { nowMs: NOW_MS },
    );
    expect(result.unavailable.map((entry) => entry.provider)).toEqual(["kimi"]);
    expect(result.unavailable[0]?.reason).toBe("no usable usage window");
  });
});

describe("formatPercent", () => {
  it("rounds provider percentages for display", () => {
    expect(formatPercent(86.41555555555556)).toBe("86.4%");
    expect(formatPercent(8)).toBe("8%");
    expect(formatPercent(28.000000000000004)).toBe("28%");
  });
});

describe("formatters", () => {
  it("renders compact countdowns", () => {
    expect(countdown(0, 30)).toBe("<1m");
    expect(countdown(0, 45 * 60)).toBe("45m");
    expect(countdown(0, 3 * 3600 + 600)).toBe("3h 10m");
    expect(countdown(0, 2 * 86_400 + 3600)).toBe("2d 1h");
    expect(countdown(0, -10)).toBe("now");
  });

  it("renders refresh ages", () => {
    expect(ageString(NOW_MS, NOW_MS)).toBe("just now");
    expect(ageString(NOW_MS - 90_000, NOW_MS)).toBe("1m ago");
    expect(ageString(NOW_MS - 10_800_000, NOW_MS)).toBe("3h ago");
  });
});
