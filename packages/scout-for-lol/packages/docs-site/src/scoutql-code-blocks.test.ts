import { describe, expect, test } from "vitest";
import path from "node:path";
import { scoutThemes } from "@scout-for-lol/design-system/themes";

/**
 * Like `docs-site.test.ts`, these assertions run against the built site
 * (`bun run build` precedes `bun run test`) — the thing being protected only
 * exists after a build.
 *
 * The docs highlight ScoutQL with the language's own tokenizer rather than a
 * TextMate grammar (`src/lib/scoutql-expressive-code.ts`). Shiki has no
 * ScoutQL grammar, so if that plugin ever stops running the fences do not
 * break: they quietly fall back to unstyled plaintext, which is exactly the
 * kind of regression nobody notices. This is the tripwire.
 */

const DIST = new URL("../dist", import.meta.url).pathname;

async function page(route: string): Promise<string> {
  const file = Bun.file(path.join(DIST, route, "index.html"));
  if (file.size === 0) {
    throw new Error(
      `${route} was not built. Run \`bun run build\` first, or run the suite through turbo (\`bunx turbo run test --filter=@scout-for-lol/docs-site\`), which builds it for you.`,
    );
  }
  return file.text();
}

const LIGHT = scoutThemes["modern-light"].colors;
const DARK = scoutThemes["modern-dark"].colors;

/** The rendered `<pre>` for the first ScoutQL block on a page. */
async function scoutQlBlock(route: string): Promise<string> {
  const found = /<pre data-language="scoutql">[\s\S]*?<\/pre>/.exec(
    await page(route),
  );
  if (found === null) {
    throw new Error(`${route} rendered no ScoutQL code block`);
  }
  return found[0];
}

/**
 * The block's source text. Expressive Code emits one `.ec-line` element per
 * line and no newline characters, so the lines are rejoined explicitly.
 */
function textOf(html: string): string {
  return html
    .split('<div class="ec-line">')
    .slice(1)
    .map((line) =>
      line
        .replaceAll(/<[^>]+>/g, "")
        .replaceAll("&#x3C;", "<")
        .replaceAll("&#x27;", "'")
        .replaceAll("&quot;", '"')
        .replaceAll("&gt;", ">")
        .replaceAll("&lt;", "<")
        .replaceAll("&amp;", "&"),
    )
    .join("\n");
}

/** Every colour the block declares, grouped by style variant index. */
function colorsByVariant(html: string): Map<string, Set<string>> {
  const byVariant = new Map<string, Set<string>>();
  for (const found of html.matchAll(/--(\d+):(#[\da-f]{6})/gi)) {
    const variant = found[1] ?? "";
    const colors = byVariant.get(variant) ?? new Set<string>();
    colors.add((found[2] ?? "").toUpperCase());
    byVariant.set(variant, colors);
  }
  return byVariant;
}

describe("ScoutQL code blocks", () => {
  test("every page with a swapped fence renders a scoutql block", async () => {
    const routes = [
      "tutorials/first-report",
      "how-to/chart-reports",
      "how-to/run-competitions",
      "how-to/link-discord-users",
      "how-to/scoutql-recipes",
      "reference/scoutql",
      "reference/scoutql-filters",
      "reference/scoutql-functions",
      "reference/scoutql-render",
    ];
    for (const route of routes) {
      expect(await page(route)).toContain('<pre data-language="scoutql">');
    }
  });

  test("tokens carry per-kind inline styles, not a plaintext fallback", async () => {
    const block = await scoutQlBlock("tutorials/first-report");
    const byVariant = colorsByVariant(block);

    // Two style variants (light + dark), each with several distinct colours.
    // A plaintext fallback would declare exactly one foreground per variant.
    expect(byVariant.size).toBeGreaterThanOrEqual(2);
    for (const colors of byVariant.values()) {
      expect(colors.size).toBeGreaterThanOrEqual(3);
    }

    const allColors = new Set(
      [...byVariant.values()].flatMap((colors) => [...colors]),
    );
    // Keywords take the `primary` design-system role in both modes.
    expect(allColors).toContain(LIGHT.primary.toUpperCase());
    expect(allColors).toContain(DARK.primary.toUpperCase());
    // The FROM target takes `focus`, which no other kind uses.
    expect(allColors).toContain(LIGHT.focus.toUpperCase());
    expect(allColors).toContain(DARK.focus.toUpperCase());
    // Keywords and the source render bold.
    expect(block).toMatch(/--\dfw:bold/);
  });

  test("the rendered block reproduces the fence text exactly", async () => {
    const source = await Bun.file(
      new URL("content/docs/tutorials/first-report.md", import.meta.url)
        .pathname,
    ).text();
    const fence = /```scoutql\n([\s\S]*?)```/.exec(source)?.[1];
    expect(fence).toBeDefined();
    expect(textOf(await scoutQlBlock("tutorials/first-report"))).toBe(
      (fence ?? "").trimEnd(),
    );
  });
});
