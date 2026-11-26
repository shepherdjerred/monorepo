import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  isStyleRule,
  parseCss,
  selectorsOf,
  stripComments,
} from "@shepherdjerred/console-ui/testing/css.ts";
import { BREAKPOINTS } from "@shepherdjerred/console-ui/tokens.ts";

/**
 * Check 1: the shared stylesheet speaks one vocabulary. Sentence case,
 * tokenised type, weights, radii, layers and colours, and one breakpoint
 * set. The deprecated page kit (`page.css`) is held to a frozen allowlist
 * instead and is deleted in K1.
 */

const styles = path.join(import.meta.dirname, "styles");

type Finding = { readonly rule: string; readonly where: string };

const COLOUR_LITERAL =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\b(?:white|black)\b/i;
/** Only dots are round (unread, timeline, live status, radio); everything else uses the radius scale. */
const ROUND_ALLOWED =
  /\.ui-(?:unread|timeline-dot|status-dot-mark|choice-dot)\b|\.ui-choice-box\[data-shape="radio"\]/;
const ALLOWED_WIDTHS = new Set(Object.values(BREAKPOINTS));

/** Property → the values it may take. A failing value is a finding. */
const ALLOWED_VALUES: Readonly<Record<string, RegExp>> = {
  "text-transform": /^none$/,
  "letter-spacing": /^(?:0|normal|-0\.006em)$/,
  "font-size": /^(?:var\(--ui-text-[a-z]+\)|inherit)$/,
  "font-weight": /^(?:var\(--ui-weight-[a-z]+\)|inherit)$/,
  "border-radius": /^(?:0|var\(--ui-radius-(?:xs|sm|md|lg|round)\))$/,
  "z-index": /^(?:var\(--ui-z-[a-z]+\)|0|1)$/,
};

const RULE_NAME: Readonly<Record<string, string>> = {
  "border-radius": "radius",
};

function declarationFindings(
  property: string,
  value: string,
  selector: string,
): string[] {
  const rules: string[] = [];
  const allowed = ALLOWED_VALUES[property];
  if (allowed !== undefined && !allowed.test(value)) {
    rules.push(RULE_NAME[property] ?? property);
  }
  if (property === "font" && value !== "inherit") {
    if (!value.includes("var(--ui-text-")) rules.push("font-size");
    if (/^\d/.test(value)) rules.push("font-weight");
  }
  if (value.includes("radius-round") && !ROUND_ALLOWED.test(selector)) {
    rules.push("round-radius");
  }
  if (COLOUR_LITERAL.test(value)) rules.push("colour-literal");
  if (/\bclamp\(/.test(value)) rules.push("clamp");
  return rules;
}

function mediaFindings(css: string): Finding[] {
  const found: Finding[] = [];
  for (const match of stripComments(css).matchAll(/@media([^{]+)\{/g)) {
    const query = (match[1] ?? "").trim();
    if (/(?:min|max)-width/.test(query)) {
      found.push({ rule: "media-range-syntax", where: query });
    }
    for (const width of query.matchAll(/width\s*[<>]=?\s*(\d+)px/g)) {
      if (!ALLOWED_WIDTHS.has(Number(width[1]))) {
        found.push({ rule: "breakpoint", where: query });
      }
    }
  }
  return found;
}

function vocabularyFindings(css: string): Finding[] {
  const found: Finding[] = mediaFindings(css);
  for (const block of parseCss(css).filter((parsed) => isStyleRule(parsed))) {
    const selector = selectorsOf(block).join(", ");
    for (const { property, value } of block.declarations) {
      for (const rule of declarationFindings(property, value, selector)) {
        found.push({ rule, where: `${selector} { ${property}: ${value} }` });
      }
    }
  }
  return found;
}

function countByRule(found: readonly Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { rule } of found) counts[rule] = (counts[rule] ?? 0) + 1;
  return counts;
}

const componentSheets = [
  ...new Bun.Glob("**/*.css").scanSync({
    cwd: path.join(styles, "components"),
  }),
].toSorted((a, b) => a.localeCompare(b));

describe("the shared stylesheet", () => {
  test("is split into one file per piece", () => {
    expect(componentSheets.length).toBeGreaterThan(15);
  });

  test.each(componentSheets)(
    "components/%s speaks the one vocabulary",
    async (name) => {
      const css = await Bun.file(path.join(styles, "components", name)).text();
      expect(vocabularyFindings(css)).toEqual([]);
    },
  );

  test("index.css imports every component file", async () => {
    const index = await Bun.file(path.join(styles, "index.css")).text();
    const imported = [
      ...index.matchAll(/@import "\.\/components\/([\w/-]+\.css)";/g),
    ].map((match) => match[1] ?? "");
    expect(imported.toSorted((a, b) => a.localeCompare(b))).toEqual(
      componentSheets,
    );
  });

  test("the deprecated page kit only shrinks (frozen allowlist)", async () => {
    const css = await Bun.file(path.join(styles, "page.css")).text();
    expect(countByRule(vocabularyFindings(css))).toEqual({
      clamp: 1,
      "font-size": 13,
      "font-weight": 10,
      "letter-spacing": 6,
      "media-range-syntax": 1,
      radius: 11,
      "text-transform": 4,
    });
  });

  test("the checks catch the old vocabulary", () => {
    const css = `@layer ui.components {
      .ui-x { text-transform: uppercase; letter-spacing: 0.1em; border-radius: 999px; font-size: 2rem; font-weight: 650; color: #fff; }
      .ui-y { border-radius: var(--ui-radius-round); font: 700 clamp(1rem, 2vw, 2rem) sans-serif; z-index: 99; }
      @media (max-width: 760px) { .ui-z { color: rgb(0 0 0); } }
      @media (width <= 760px) { .ui-z { color: var(--ui-ink); } }
    }`;
    expect(countByRule(vocabularyFindings(css))).toEqual({
      breakpoint: 1,
      clamp: 1,
      "colour-literal": 2,
      "font-size": 2,
      "font-weight": 2,
      "letter-spacing": 1,
      "media-range-syntax": 1,
      radius: 1,
      "round-radius": 1,
      "text-transform": 1,
      "z-index": 1,
    });
  });
});
