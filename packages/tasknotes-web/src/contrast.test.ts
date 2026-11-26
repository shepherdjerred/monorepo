import { describe, expect, test } from "vitest";

function channel(value: number): number {
  const scale = value / 255;
  return scale <= 0.04045 ? scale / 12.92 : ((scale + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = channel((value >> 16) & 255);
  const green = channel((value >> 8) & 255);
  const blue = channel(value & 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(left: string, right: string): number {
  const lighter = Math.max(luminance(left), luminance(right));
  const darker = Math.min(luminance(left), luminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function color(css: string, name: string): string {
  const match = new RegExp(String.raw`--${name}:\s*(#[0-9a-fA-F]{6})`).exec(
    css,
  );
  const value = match?.[1];
  if (value === undefined) throw new Error(`Missing --${name}`);
  return value;
}

describe("palette contrast", () => {
  test("text and controls meet WCAG AA on both schemes", async () => {
    const css = await Bun.file(new URL("styles.css", import.meta.url)).text();
    const pairs = [
      ["color-text-light", "color-background-light", 4.5],
      ["color-text-secondary-light", "color-background-light", 4.5],
      ["color-text-tertiary-light", "color-surface-light", 3],
      ["color-surface-light", "color-brand-light", 4.5],
      ["color-error-light", "color-background-light", 4.5],
      ["color-text-dark", "color-background-dark", 4.5],
      ["color-text-secondary-dark", "color-surface-dark", 4.5],
      ["color-text-light", "color-brand-dark", 4.5],
      ["color-error-dark", "color-surface-dark", 4.5],
      ["color-brand-light", "color-background-light", 3],
      ["priority-p1-light", "color-background-light", 4.5],
      ["priority-p2-light", "color-background-light", 4.5],
      ["priority-p3-light", "color-background-light", 4.5],
      ["priority-p1-dark", "color-surface-dark", 4.5],
      ["priority-p2-dark", "color-surface-dark", 4.5],
      ["priority-p3-dark", "color-surface-dark", 4.5],
      ["color-success-light", "color-background-light", 4.5],
      ["color-success-dark", "color-background-dark", 3],
      ["color-check-light", "color-action", 4.5],
    ] as const;
    for (const [foreground, background, minimum] of pairs) {
      expect(
        contrast(color(css, foreground), color(css, background)),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(minimum);
    }
  });
});
