import { describe, expect, test } from "vitest";
import { themeCatalog } from "#src/catalog.ts";
import { contrast } from "#src/colors.ts";
import { readPreferences } from "#src/preferences.ts";

describe("shared palettes", () => {
  for (const theme of themeCatalog.themes) {
    for (const mode of ["light", "dark"] as const) {
      test(`${theme.id} ${mode} has readable content and controls`, () => {
        const p = theme.palettes[mode];
        for (const [foreground, background, minimum] of [
          [p.textColor, p.contentBg, 4.5],
          [p.linkColor, p.contentBg, 4.5],
          [p.linkHoverColor, p.contentBg, 4.5],
          [p.chromeTextColor, p.chromeBg, 4.5],
          [p.chromeHoverColor, p.chromeBg, 4.5],
          [p.subNavTextColor, p.subNavBg, 4.5],
          [p.majorHeadingTextColor, p.majorHeadingBg, 4.5],
          [p.selectedItemColor, p.selectedItemBgColor, 4.5],
          [p.buttonPrimaryColor, p.buttonPrimaryBg, 4.5],
          [p.textColor, p.contentAltBg, 4.5],
          [p.textColor, p.contentHighlightBg, 4.5],
          [p.buttonCtaColor, p.buttonCtaBg, 4.5],
          [p.controlColor, p.inputBgColor, 3],
          [p.focusColor, p.contentBg, 3],
          [p.inputBorderColor, p.inputBgColor, 3],
        ] as const)
          expect(contrast(foreground, background)).toBeGreaterThanOrEqual(
            minimum,
          );
      });
    }
  }
  test("motion exists only on festival themes", () => {
    for (const theme of themeCatalog.themes)
      expect(theme.effect !== null).toBe(theme.window !== null);
  });
  test("visitor cookies validate choices", () => {
    expect(readPreferences("storm_preferences=broken")).toBeUndefined();
    expect(
      readPreferences(
        "storm_preferences=" +
          encodeURIComponent(
            JSON.stringify({
              version: 1,
              appearance: "system",
              theme: "auto",
              effects: false,
            }),
          ),
      ),
    ).toMatchObject({ effects: false });
    expect(
      readPreferences(
        "storm_preferences=" +
          encodeURIComponent(
            JSON.stringify({
              version: 1,
              appearance: "system",
              theme: "unknown",
              effects: true,
            }),
          ),
      ),
    ).toBeUndefined();
  });
});
