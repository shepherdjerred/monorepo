import { describe, expect, it } from "vitest";
import type { RankedEntry } from "#lib/brim/rank.ts";
import {
  budgetRemaining,
  columnWidths,
  formatAlignedStats,
  formatCompactStats,
  formatPickerName,
  formatPickerRow,
  moveIndex,
  pickerOptions,
  pressureColor,
  pressureForRemaining,
  usageBar,
} from "#lib/brim/selection.ts";

function entry(
  provider: string,
  overrides: Partial<RankedEntry> = {},
): RankedEntry {
  return {
    provider,
    displayName: provider,
    accountLabel: null,
    available: true,
    reason: null,
    fiveHourUsed: null,
    budgetUsed: 10,
    budgetKind: "weekly",
    pace: null,
    budgetResetsIn: null,
    fallbackWindow: null,
    snapshotAge: null,
    ...overrides,
  };
}

describe("pickerOptions", () => {
  it("orders ranked entries before other entries", () => {
    const ranked = entry("codex");
    const other = entry("kimi", {
      budgetUsed: null,
      budgetKind: null,
      fallbackWindow: ["Shared usage", 28],
    });
    const options = pickerOptions({
      ranked: [ranked],
      other: [other],
      unavailable: [],
    });
    expect(options.map((option) => option.key)).toEqual(["codex", "kimi"]);
    expect(options[1]?.entry).toBe(other);
  });
});

describe("moveIndex", () => {
  it("moves within bounds", () => {
    expect(moveIndex(0, 1, 3)).toBe(1);
    expect(moveIndex(1, -1, 3)).toBe(0);
  });

  it("wraps around both ends", () => {
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(2, 1, 3)).toBe(0);
  });

  it("stays at zero for an empty list", () => {
    expect(moveIndex(0, 1, 0)).toBe(0);
  });
});

describe("pressureForRemaining", () => {
  it("mirrors Brim's remaining-based thresholds", () => {
    expect(pressureForRemaining(100)).toBe("ok");
    expect(pressureForRemaining(30)).toBe("ok");
    expect(pressureForRemaining(29.9)).toBe("low");
    expect(pressureForRemaining(10)).toBe("low");
    expect(pressureForRemaining(9.9)).toBe("critical");
    expect(pressureForRemaining(null)).toBe(null);
  });

  it("maps pressure to bar colors", () => {
    expect(pressureColor("ok")).toBe("green");
    expect(pressureColor("low")).toBe("yellow");
    expect(pressureColor("critical")).toBe("red");
    expect(pressureColor(null)).toBe("green");
  });
});

describe("usageBar", () => {
  it("renders a fixed-width consumption bar", () => {
    expect(usageBar(0)).toBe("░░░░░░░░░░");
    expect(usageBar(100)).toBe("██████████");
    expect(usageBar(86.4)).toBe("█████████░");
    expect(usageBar(50, 4)).toBe("██░░");
  });

  it("clamps out-of-range input", () => {
    expect(usageBar(-5)).toBe("░░░░░░░░░░");
    expect(usageBar(140)).toBe("██████████");
  });
});

describe("budgetRemaining", () => {
  it("derives remaining from budget or fallback windows", () => {
    expect(budgetRemaining(entry("a", { budgetUsed: 40 }))).toBe(60);
    expect(
      budgetRemaining(
        entry("b", {
          budgetUsed: null,
          budgetKind: null,
          fallbackWindow: ["Shared usage", 28],
        }),
      ),
    ).toBe(72);
    expect(
      budgetRemaining(
        entry("c", {
          budgetUsed: null,
          budgetKind: null,
          fallbackWindow: null,
        }),
      ),
    ).toBe(null);
  });
});

describe("formatPickerName", () => {
  it("appends the account label when present", () => {
    expect(formatPickerName(entry("grok", { displayName: "Grok" }))).toBe(
      "Grok",
    );
    expect(
      formatPickerName(
        entry("muse", {
          displayName: "Meta Muse",
          accountLabel: "Muse Code High Usage",
        }),
      ),
    ).toBe("Meta Muse (Muse Code High Usage)");
  });
});

describe("formatCompactStats", () => {
  it("shrinks labels to fit the picker box", () => {
    expect(
      formatCompactStats(
        entry("cursor", {
          budgetUsed: 86.41555555555556,
          budgetKind: "monthly",
          fiveHourUsed: null,
          pace: "behind",
          budgetResetsIn: "8d 21h",
        }),
      ),
    ).toBe("monthly 86.4% · 5h n/a · behind · 8d 21h");
  });

  it("omits missing pace and reset segments", () => {
    expect(
      formatCompactStats(
        entry("kimi", {
          budgetUsed: null,
          budgetKind: null,
          fiveHourUsed: 0,
          pace: null,
          budgetResetsIn: null,
          fallbackWindow: ["Shared usage", 28],
        }),
      ),
    ).toBe("Shared usage 28% · 5h 0%");
  });
});

describe("formatAlignedStats", () => {
  it("pads every segment to a shared width", () => {
    const widths = columnWidths([
      entry("grok", { displayName: "Grok" }),
      entry("antigravity", { displayName: "Google Antigravity" }),
    ]);
    expect(widths.name).toBe("Google Antigravity".length);
    expect(
      formatAlignedStats(
        entry("cursor", {
          budgetUsed: 8,
          budgetKind: "weekly",
          fiveHourUsed: 1,
          pace: "ahead",
          budgetResetsIn: "6d 1h",
        }),
        widths,
      ),
    ).toBe("weekly     8% · 5h   1% · ahead   · 6d 1h");
    expect(
      formatAlignedStats(
        entry("cursor", {
          budgetUsed: 86.41555555555556,
          budgetKind: "monthly",
          fiveHourUsed: null,
          pace: "behind",
          budgetResetsIn: "8d 21h",
        }),
        widths,
      ),
    ).toBe("monthly 86.4% · 5h  n/a · behind  · 8d 21h");
  });

  it("leaves fallback windows unpadded", () => {
    const widths = columnWidths([entry("kimi")]);
    expect(
      formatAlignedStats(
        entry("kimi", {
          budgetUsed: null,
          budgetKind: null,
          fiveHourUsed: 0,
          pace: null,
          budgetResetsIn: null,
          fallbackWindow: ["Shared usage", 28],
        }),
        widths,
      ),
    ).toBe("Shared usage 28% · 5h   0%");
  });
});

describe("formatPickerRow", () => {
  it("renders budget, 5-hour, pace, and reset parts", () => {
    expect(
      formatPickerRow(
        entry("cursor", {
          displayName: "Cursor",
          budgetUsed: 86.41555555555556,
          budgetKind: "monthly",
          fiveHourUsed: null,
          pace: "behind",
          budgetResetsIn: "8d 21h",
        }),
      ),
    ).toBe(
      "Cursor — monthly 86.4% used · 5h n/a · pace behind · resets in 8d 21h",
    );
  });

  it("renders fallback windows for other entries", () => {
    expect(
      formatPickerRow(
        entry("kimi", {
          displayName: "Kimi Code",
          budgetUsed: null,
          budgetKind: null,
          fiveHourUsed: 0,
          fallbackWindow: ["Shared usage", 28.000000000000004],
        }),
      ),
    ).toBe("Kimi Code — Shared usage 28% used · 5h 0% used");
  });
});
