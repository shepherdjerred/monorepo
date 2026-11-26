import path from "node:path";
import { describe, expect, test } from "vitest";
import { renderTokensCss, tokens } from "@shepherdjerred/console-ui/tokens.ts";

const styles = path.join(import.meta.dirname, "styles");

async function stylesheet(name: string): Promise<string> {
  return Bun.file(path.join(styles, name)).text();
}

function withoutComments(css: string): string {
  return css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
}

describe("tokens.json", () => {
  test("both themes define the same tokens", () => {
    expect(Object.keys(tokens.dark)).toEqual(Object.keys(tokens.light));
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

  test.each([
    "reset.css",
    "tokens.css",
    "fonts.css",
    "components.css",
    "page.css",
  ])("%s keeps every rule inside a ui.* layer", async (name) => {
    const css = withoutComments(await stylesheet(name)).trim();
    const topLevel = css
      .replaceAll(/@import [^;]+ layer\(ui\.[a-z]+\);/g, "")
      .trim();
    expect(topLevel).toMatch(/^@layer ui\.[a-z]+ \{[\s\S]*\}$/);
    expect(topLevel.match(/^@layer /gm)).toHaveLength(1);
  });

  test.each(["components.css", "page.css"])(
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

  test.each(["components.css", "page.css"])(
    "%s colours come only from --ui-* tokens",
    async (name) => {
      const css = withoutComments(await stylesheet(name));
      expect(css.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    },
  );

  test("no stylesheet loads a Berkeley Mono file", async () => {
    for (const name of [
      "index.css",
      "reset.css",
      "tokens.css",
      "fonts.css",
      "components.css",
      "page.css",
    ]) {
      expect(await stylesheet(name)).not.toMatch(/url\([^)]*berkeley/i);
    }
  });
});
