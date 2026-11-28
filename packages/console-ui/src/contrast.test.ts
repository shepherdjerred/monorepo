import { describe, expect, test } from "vitest";
import {
  SEVERITIES,
  tokens,
  type ThemeName,
  type TokenName,
} from "@shepherdjerred/console-ui/tokens.ts";

// WCAG 2.2 relative luminance and contrast ratio.
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((index) =>
    channel(Number.parseInt(hex.slice(index, index + 2), 16)),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light = 0, dark = 0] = [luminance(a), luminance(b)].sort(
    (x, y) => y - x,
  );
  return (light + 0.05) / (dark + 0.05);
}

type Pair = { foreground: TokenName; background: TokenName };

function pairs(
  foregrounds: readonly TokenName[],
  backgrounds: readonly TokenName[],
): Pair[] {
  return foregrounds.flatMap((foreground) =>
    backgrounds.map((background) => ({ foreground, background })),
  );
}

const PANEL_SURFACES = ["bg", "panel", "head", "hover"] as const;
const SIDEBAR_SURFACES = ["side-hover", "active"] as const;
const ALL_SURFACES = [...PANEL_SURFACES, ...SIDEBAR_SURFACES] as const;

/** Text needs 4.5:1 (WCAG 1.4.3) on every surface it is drawn on. */
const TEXT_PAIRS: readonly Pair[] = [
  // Ink levels in the panel and the sidebar, including hovered and selected rows.
  ...pairs(["ink", "ink-2", "muted"], ALL_SURFACES),
  // Faint text (counts, group labels, placeholders) stays off the darker
  // sidebar fills: a hovered or selected row switches its count to muted.
  ...pairs(["faint"], PANEL_SURFACES),
  ...pairs(["accent"], PANEL_SURFACES),
  { foreground: "on-accent", background: "accent" },
  // Avatar initials on the track fill.
  { foreground: "ink-2", background: "track" },
  // Severity words and figures, and email chips on their soft tints.
  ...SEVERITIES.flatMap((severity) =>
    pairs(
      [`sev-${severity}-text`],
      [...PANEL_SURFACES, `sev-${severity}-soft`],
    ),
  ),
];

/** Glyphs, meter fills and state indicators need 3:1 (WCAG 1.4.11). */
const NON_TEXT_PAIRS: readonly Pair[] = [
  // Status glyphs in rows and strips, and meter fills against their track.
  ...SEVERITIES.flatMap((severity) =>
    pairs([`sev-${severity}`], [...PANEL_SURFACES, "track"]),
  ),
  // Selected-row icon, tab underline, unread dot, focus ring and focused field border.
  ...pairs(["accent"], [...ALL_SURFACES, "track"]),
];

const THEMES: readonly ThemeName[] = ["light", "dark"];

describe("token contrast", () => {
  for (const theme of THEMES) {
    describe(theme, () => {
      test.each(TEXT_PAIRS)(
        "$foreground on $background meets 4.5:1",
        ({ foreground, background }) => {
          expect(
            contrast(tokens[theme][foreground], tokens[theme][background]),
          ).toBeGreaterThanOrEqual(4.5);
        },
      );
      test.each(NON_TEXT_PAIRS)(
        "$foreground against $background meets 3:1",
        ({ foreground, background }) => {
          expect(
            contrast(tokens[theme][foreground], tokens[theme][background]),
          ).toBeGreaterThanOrEqual(3);
        },
      );
    });
  }

  test("the contrast formula matches WCAG's black-on-white maximum", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });
});
