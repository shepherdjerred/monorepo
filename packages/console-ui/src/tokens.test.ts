import path from "node:path";
import { describe, expect, test } from "vitest";
import tokensJson from "@shepherdjerred/console-ui/tokens.json" with { type: "json" };
import {
  BREAKPOINTS,
  SIDEBAR_QUERY,
  renderTokensCss,
  tokens,
} from "@shepherdjerred/console-ui/tokens.ts";

const styles = path.join(import.meta.dirname, "styles");

async function stylesheet(name: string): Promise<string> {
  return Bun.file(path.join(styles, name)).text();
}

const componentSheets = [
  ...new Bun.Glob("*.css").scanSync({ cwd: path.join(styles, "components") }),
].map((name) => `components/${name}`);
const classSheets = [...componentSheets, "page.css"];

function withoutComments(css: string): string {
  return css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
}

describe("tokens.json", () => {
  test("both themes define the same tokens", () => {
    expect(Object.keys(tokens.dark)).toEqual(Object.keys(tokens.light));
  });

  test("translucent colours exist for both themes", () => {
    expect(Object.keys(tokensJson.translucent.dark)).toEqual(
      Object.keys(tokensJson.translucent.light),
    );
  });

  test("breakpoints reach scripts and the generated phone overrides", () => {
    expect(BREAKPOINTS).toEqual({ phone: 600, sidebar: 900 });
    expect(SIDEBAR_QUERY).toBe("(width > 900px)");
    expect(renderTokensCss()).toContain("@media (width <= 600px)");
  });

  test("every value is a six-digit hex colour, which emails can inline", () => {
    for (const theme of [tokens.light, tokens.dark]) {
      for (const value of Object.values(theme)) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});

describe("stylesheets", () => {
  test("tokens.css is generated from tokens.json (run `bun run generate`)", async () => {
    expect(await stylesheet("tokens.css")).toBe(renderTokensCss());
  });

  test("index.css declares the layer order before importing", async () => {
    const css = withoutComments(await stylesheet("index.css")).trim();
    expect(css.startsWith("@layer ui.reset, ui.tokens, ui.components;")).toBe(
      true,
    );
  });

  test.each(["reset.css", "tokens.css", "fonts.css", ...classSheets])(
    "%s keeps every rule inside a ui.* layer",
    async (name) => {
      const css = withoutComments(await stylesheet(name)).trim();
      const topLevel = css
        .replaceAll(/@import [^;]+ layer\(ui\.[a-z]+\);/g, "")
        .trim();
      expect(topLevel).toMatch(/^@layer ui\.[a-z]+ \{[\s\S]*\}$/);
      expect(topLevel.match(/^@layer /gm)).toHaveLength(1);
    },
  );

  test.each(classSheets)(
    "every class in %s uses the ui- prefix",
    async (file) => {
      const css = withoutComments(await stylesheet(file)).replaceAll(
        /@layer [^{]+/g,
        "",
      );
      const classes = [...css.matchAll(/\.(-?[_a-z][\w-]*)/gi)]
        .map((match) => match[1])
        .filter((name) => name !== undefined && !/^\d/.test(name));
      expect(classes.length).toBeGreaterThan(0);
      expect(classes.filter((name) => !name?.startsWith("ui-"))).toEqual([]);
    },
  );

  test.each(classSheets)(
    "%s colours come only from --ui-* tokens",
    async (name) => {
      const css = withoutComments(await stylesheet(name));
      expect(css.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    },
  );

  test("fonts.css declares Berkeley Mono from committed WOFF2 files", async () => {
    const css = await stylesheet("fonts.css");
    const faces = [
      ...css.matchAll(
        /@font-face \{[^}]*url\("(\.\/fonts\/[^"]+)"\)[^}]*font-weight: (\d+);/g,
      ),
    ].map(([, url = "", weight]) => ({ url, weight }));
    expect(faces).toEqual([
      { url: "./fonts/BerkeleyMono-Regular.woff2", weight: "400" },
      { url: "./fonts/BerkeleyMono-Bold.woff2", weight: "700" },
    ]);
    for (const { url } of faces) {
      const bytes = await Bun.file(path.join(styles, url)).bytes();
      expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("wOF2");
    }
  });
});
