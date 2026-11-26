import { describe, expect, test } from "vitest";
import { scoutThemes } from "#src/generated/tokens.ts";

const stylesRoot = new URL("../styles/", import.meta.url);
const packagesRoot = new URL("../../", import.meta.url);

async function read(url: URL): Promise<string> {
  return Bun.file(url).text();
}

function flatten(css: string): string {
  return css
    .replaceAll(/\s+/g, " ")
    .replaceAll("( ", "(")
    .replaceAll(" )", ")");
}

function declaration(css: string, name: string): string {
  const match = new RegExp(String.raw`${name}:\s*([^;]+);`).exec(flatten(css));
  if (match?.[1] === undefined) {
    throw new Error(`friendly.css does not declare ${name}`);
  }
  return match[1].trim();
}

type Rgb = readonly [number, number, number];

function parse(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** `color-mix(in srgb, a <share>%, b)` for opaque colours. */
function mix(a: Rgb, share: number, b: Rgb): Rgb {
  return [
    a[0] * share + b[0] * (1 - share),
    a[1] * share + b[1] * (1 - share),
    a[2] * share + b[2] * (1 - share),
  ];
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Rgb): number {
  return (
    0.2126 * channel(color[0]) +
    0.7152 * channel(color[1]) +
    0.0722 * channel(color[2])
  );
}

function contrast(foreground: Rgb, background: Rgb): number {
  const high = Math.max(luminance(foreground), luminance(background));
  const low = Math.min(luminance(foreground), luminance(background));
  return (high + 0.05) / (low + 0.05);
}

describe("friendly.css surface variables", () => {
  test("is imported by the package stylesheet after the tokens", async () => {
    const index = await read(new URL("index.css", stylesRoot));
    const tokens = index.indexOf('@import "./generated/tokens.css"');
    const friendly = index.indexOf('@import "./friendly.css"');
    expect(tokens).toBeGreaterThanOrEqual(0);
    expect(friendly).toBeGreaterThan(tokens);
  });

  test("declares the variables on every themed element, not only :root", async () => {
    const css = flatten(await read(new URL("friendly.css", stylesRoot)));
    expect(css).toContain(":root, [data-scout-skin][data-scout-mode] {");
  });

  test("derives radii from the large radius token so classic squares them", async () => {
    const css = await read(new URL("friendly.css", stylesRoot));
    expect(declaration(css, "--scout-radius-panel")).toBe(
      "calc(var(--scout-radius-large) * 2)",
    );
    expect(declaration(css, "--scout-radius-pill")).toBe(
      "calc(var(--scout-radius-large) * 4)",
    );
  });

  test("uses the mockup mixes and no literal colours", async () => {
    const css = await read(new URL("friendly.css", stylesRoot));
    expect(declaration(css, "--scout-surface-inset")).toBe(
      "color-mix(in srgb, var(--scout-color-canvas) 62%, var(--scout-color-surface))",
    );
    expect(declaration(css, "--scout-surface-inset-strong")).toBe(
      "color-mix(in srgb, var(--scout-color-text) 11%, var(--scout-surface-inset))",
    );
    expect(declaration(css, "--scout-brand-soft")).toBe(
      "color-mix(in srgb, var(--scout-color-primary) 12%, var(--scout-color-surface))",
    );
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(/);
  });

  for (const [name, theme] of Object.entries(scoutThemes)) {
    test(`${name} text stays readable on the derived surfaces`, () => {
      const { canvas, surface, text, textMuted, primary, primaryText } =
        theme.colors;
      const inset = mix(parse(canvas), 0.62, parse(surface));
      const insetStrong = mix(parse(text), 0.11, inset);
      const brandSoft = mix(parse(primary), 0.12, parse(surface));
      expect(contrast(parse(text), inset)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parse(text), insetStrong)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parse(textMuted), inset)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parse(textMuted), parse(canvas))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(parse(text), brandSoft)).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(parse(primaryText), parse(primary)),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("Tailwind token mapping", () => {
  const files = {
    app: new URL("app/src/styles/global.css", packagesRoot),
    frontend: new URL("frontend/src/styles/global.css", packagesRoot),
  } as const;

  for (const [name, url] of Object.entries(files)) {
    test(`${name} maps chart, win and loss utilities from existing tokens`, async () => {
      const css = flatten(await read(url));
      for (let index = 1; index <= 8; index += 1) {
        expect(css).toContain(
          `--color-scout-chart${String(index)}: var(--scout-color-chart${String(index)});`,
        );
      }
      expect(css).toContain(
        "--color-scout-win: var(--scout-color-success-on-surface);",
      );
      expect(css).toContain(
        "--color-scout-win-fill: var(--scout-color-success);",
      );
      expect(css).toContain(
        "--color-scout-loss: var(--scout-color-danger-on-surface);",
      );
      expect(css).toContain(
        "--color-scout-loss-fill: var(--scout-color-danger);",
      );
    });

    test(`${name} maps success and danger to text colours with separate fills`, async () => {
      const css = flatten(await read(url));
      expect(css).toContain(
        "--color-scout-success: var(--scout-color-success-on-surface);",
      );
      expect(css).toContain(
        "--color-scout-success-fill: var(--scout-color-success);",
      );
      expect(css).toContain(
        "--color-scout-danger: var(--scout-color-danger-on-surface);",
      );
      expect(css).toContain(
        "--color-scout-danger-fill: var(--scout-color-danger);",
      );
    });
  }
});
