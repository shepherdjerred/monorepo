import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * WCAG contrast of every token pair the client draws, in both themes. The
 * pairs are the ones components use: text on each surface, a control's
 * boundary against the surface it sits on, the focus ring, and a status's
 * text on its own fill. A new pair belongs here when a component introduces it.
 */
const tokens = await readFile(
  path.join(import.meta.dirname, "tokens.css"),
  "utf8",
);
const css = tokens.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
const rootRules = css.slice(css.indexOf(":root {"));
const declared = new Map<string, string>();
for (const match of rootRules.matchAll(/--([\w-]+):([^;]+);/gu)) {
  const [, name, value] = match;
  if (name !== undefined && value !== undefined && !declared.has(name)) {
    declared.set(name, value.trim());
  }
}

type Theme = "light" | "dark";

function topLevelParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

/** A token's value in one theme, as a hex color. */
function resolve(value: string, theme: Theme): string {
  const reference = /^var\(--([\w-]+)\)$/u.exec(value.trim());
  if (reference?.[1] !== undefined) {
    const target = declared.get(reference[1]);
    if (target === undefined) throw new Error(`No token --${reference[1]}`);
    return resolve(target, theme);
  }
  const pair = /^light-dark\((.*)\)$/su.exec(value.trim());
  if (pair?.[1] !== undefined) {
    const chosen = topLevelParts(pair[1])[theme === "light" ? 0 : 1];
    if (chosen === undefined) throw new Error(`Bad light-dark(): ${value}`);
    return resolve(chosen, theme);
  }
  return value.trim();
}

function luminance(hex: string): number {
  const digits = hex.replace("#", "");
  const full = digits.length === 3 ? digits.replaceAll(/./gu, "$&$&") : digits;
  const [red = 0, green = 0, blue = 0] = [0, 2, 4].map((index) => {
    const unit = Number.parseInt(full.slice(index, index + 2), 16) / 255;
    return unit <= 3.928 / 100 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string, theme: Theme) {
  const a = luminance(resolve(`var(--${foreground})`, theme));
  const b = luminance(resolve(`var(--${background})`, theme));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const SURFACES = [
  "canvas",
  "surface",
  "surface-raised",
  "surface-sunken",
  "surface-selected",
  "field",
];
const STATUSES = ["ok", "progress", "warn", "danger", "neutral"];

/** [foreground token, background token, minimum ratio, what it is] */
type Pair = [string, string, number, string];

const PAIRS: Pair[] = [
  ...SURFACES.flatMap((surface): Pair[] => [
    ["text", surface, 4.5, "body text"],
    ["text-muted", surface, 4.5, "muted text and placeholders"],
    // 1.4.11: a control's boundary, a focus ring, and a mark with no edge.
    ["border-strong", surface, 3, "a control's boundary"],
    ["focus", surface, 3, "the focus ring"],
    ["accent-strong", surface, 3, "a checkbox or meter fill"],
  ]),
  ...["canvas", "surface", "surface-sunken", "surface-selected"].map(
    (surface): Pair => ["text-accent", surface, 4.5, "accent text and links"],
  ),
  ["text-on-accent", "accent", 4.5, "a primary button"],
  ["text-on-accent", "accent-hover", 4.5, "a primary button, hovered"],
  ...["canvas", "surface", "surface-sunken"].map((surface): Pair => [
    "accent-border",
    surface,
    3,
    "a primary button's edge",
  ]),
  ...STATUSES.map((status): Pair => [
    status,
    `${status}-soft`,
    4.5,
    "a status on its fill",
  ]),
  ...["canvas", "surface", "surface-raised"].flatMap((surface) =>
    STATUSES.map((status): Pair => [
      status,
      surface,
      4.5,
      "a status color used as text",
    ]),
  ),
];

for (const theme of ["light", "dark"] as const) {
  test(`every token pair meets its contrast in the ${theme} theme`, () => {
    const short = PAIRS.flatMap(([foreground, background, minimum, role]) => {
      const ratio = contrast(foreground, background, theme);
      return ratio >= minimum
        ? []
        : [
            `${foreground} on ${background} (${role}): ${ratio.toFixed(2)}, needs ${String(minimum)}`,
          ];
    });
    expect(short).toEqual([]);
  });
}
