import { describe, expect, test } from "vitest";
import { scoutThemes } from "./tokens.ts";

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return (
    0.2126 * channel(Number.parseInt(hex.slice(1, 3), 16)) +
    0.7152 * channel(Number.parseInt(hex.slice(3, 5), 16)) +
    0.0722 * channel(Number.parseInt(hex.slice(5, 7), 16))
  );
}

function contrast(foreground: string, background: string): number {
  const high = Math.max(luminance(foreground), luminance(background));
  const low = Math.min(luminance(foreground), luminance(background));
  return (high + 0.05) / (low + 0.05);
}

describe("Scout theme contrast", () => {
  for (const [name, theme] of Object.entries(scoutThemes)) {
    const pairs = [
      ["text/canvas", theme.colors.text, theme.colors.canvas],
      ["text/surface", theme.colors.text, theme.colors.surface],
      ["muted/surface", theme.colors.textMuted, theme.colors.surface],
      ["primary", theme.colors.primaryText, theme.colors.primary],
      ["accent", theme.colors.accentText, theme.colors.accent],
      ["success", theme.colors.successText, theme.colors.success],
      ["warning", theme.colors.warningText, theme.colors.warning],
      ["danger", theme.colors.dangerText, theme.colors.danger],
      ["info", theme.colors.infoText, theme.colors.info],
    ] as const;
    test(`${name} text and interactive pairs meet WCAG AA`, () => {
      for (const [label, foreground, background] of pairs) {
        expect(contrast(foreground, background), label).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });

    test(`${name} exposes distinct semantic team-side colors`, () => {
      expect(theme.colors.teamBlue).toMatch(/^#[\dA-F]{6}$/i);
      expect(theme.colors.teamRed).toMatch(/^#[\dA-F]{6}$/i);
      expect(theme.colors.teamBlue).not.toBe(theme.colors.teamRed);
    });
  }
});
