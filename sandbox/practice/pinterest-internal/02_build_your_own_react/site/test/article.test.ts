import { describe, expect, it } from "vitest";
import {
  loadArticleSource,
  parseArticle,
  parseFocus,
  splitSource,
} from "#lib/article.ts";
import { defined } from "#lib/invariant.ts";

const fence = "```";
describe("article structure", () => {
  it("keeps nested prose examples in their code step and image-wave code in prose", () => {
    const source = `<CodeWave>\n\n${fence}tsx\nconst a = 1\n${fence}\n\nBefore.\n\n<div>\n\n${fence}json\n{"a": 1}\n${fence}\n\n</div>\n\n${fence}tsx\nconst a = 2\n${fence}\n\nAfter.\n\n</CodeWave>\n\n<ImageWave>\n\n![Tree](./fiber0.png)\n\n${fence}tsx\nconst b = 3\n${fence}\n\n</ImageWave>`;
    const article = parseArticle(source, () => {
      throw new Error("Unexpected file read");
    });
    const [code, images] = article.blocks;
    expect(code?.kind).toBe("wave");
    expect(images?.kind).toBe("wave");
    if (code?.kind !== "wave" || images?.kind !== "wave")
      throw new Error("Missing wave");
    expect(code.steps).toHaveLength(2);
    expect(defined(code.steps[0]).markdown).toContain('```json\n{"a": 1}');
    expect(images.steps).toHaveLength(1);
    expect(defined(images.steps[0]).markdown).toContain("const b = 3");
  });
  it("preserves the full article's six waves and five fiber images", async () => {
    const article = await loadArticleSource();
    const waves = article.blocks.filter((block) => block.kind === "wave");
    expect(waves.map((wave) => wave.steps.length)).toEqual([
      9, 14, 5, 5, 34, 15,
    ]);
    expect(defined(waves[3]).steps.every((step) => step.kind === "image")).toBe(
      true,
    );
    expect(
      defined(waves[1]).steps.some((step) =>
        step.markdown.includes('"children": [a, b]'),
      ),
    ).toBe(true);
  });
  it("rejects missing markers, references, and invalid typed focus", () => {
    expect(() => splitSource("const x = 1")).toThrow("marker");
    expect(() => parseFocus("0,5", "one\ntwo")).toThrow();
    expect(() => parseFocus("2:1", "one\ntwo")).toThrow();
    expect(() => parseFocus("1[1:9]", "short")).toThrow();
    expect(() => parseFocus("1garbage", "short")).toThrow();
    expect(parseFocus("1[2:4],2", "hello\nworld")).toEqual([
      { line: 1, columns: [2, 4] },
      { line: 2 },
    ]);
    expect(() =>
      parseArticle(
        `<CodeWave>\n\n${fence}tsx file=./missing.jsx\n\n${fence}\n\n</CodeWave>`,
        () => "",
      ),
    ).toThrow("reference");
  });
});
