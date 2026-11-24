import { describe, expect, test } from "vitest";
import tokens from "@shepherdjerred/console-ui/tokens.json" with { type: "json" };
import type { EmailTone } from "./primitives.ts";
import { HUB_EDITORIAL_PALETTE as p } from "./themes.ts";

/** sRGB `color-mix(in srgb, <hex> 65%, black)`, as the console primary button edge. */
function mixWithBlack(hex: string): string {
  const channels = [1, 3, 5].map((i) =>
    Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * 0.65)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${channels.join("")}`;
}

const toneTokens: readonly (readonly [EmailTone, string])[] = [
  ["critical", "error"],
  ["warning", "warning"],
  ["ok", "ok"],
  ["info", "info"],
  ["neutral", "unknown"],
];

describe("email palette matches the console-ui tokens", () => {
  test("surfaces, ink, lines and accent", () => {
    for (const [mode, t] of [
      ["Light", tokens.light],
      ["Dark", tokens.dark],
    ] as const) {
      expect(p[`canvas${mode}`]).toBe(t.bg);
      expect(p[`surface${mode}`]).toBe(t.panel);
      expect(p[`subtle${mode}`]).toBe(t.head);
      expect(p[`ink${mode}`]).toBe(t.ink);
      expect(p[`secondaryInk${mode}`]).toBe(t["ink-2"]);
      expect(p[`muted${mode}`]).toBe(t.muted);
      expect(p[`border${mode}`]).toBe(t.line);
      expect(p[`hairline${mode}`]).toBe(t["line-soft"]);
      expect(p[`brand${mode}`]).toBe(t.accent);
      expect(p[`ctaBg${mode}`]).toBe(t.accent);
      expect(p[`ctaInk${mode}`]).toBe(t["on-accent"]);
      expect(p[`ctaEdge${mode}`]).toBe(mixWithBlack(t.accent));
    }
  });

  test("every tone maps to its severity tokens", () => {
    const light: Record<string, string> = tokens.light;
    const dark: Record<string, string> = tokens.dark;
    for (const [tone, sev] of toneTokens) {
      const c = p.tones[tone];
      expect(c.bg).toBe(light[`sev-${sev}-soft`]);
      expect(c.ink).toBe(light[`sev-${sev}-text`]);
      expect(c.accent).toBe(light[`sev-${sev}`]);
      expect(c.border).toBe(light["line"]);
      expect(c.darkBg).toBe(dark[`sev-${sev}-soft`]);
      expect(c.darkInk).toBe(dark[`sev-${sev}-text`]);
      expect(c.darkAccent).toBe(dark[`sev-${sev}`]);
      expect(c.darkBorder).toBe(dark["line"]);
    }
  });
});
