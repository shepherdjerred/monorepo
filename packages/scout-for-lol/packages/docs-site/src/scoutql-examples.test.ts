import { describe, expect, test } from "vitest";
import path from "node:path";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import { lintScoutQl } from "@scout-for-lol/data/model/scoutql/lint.ts";

/**
 * Every ScoutQL example in the documentation is compiled by the real compiler.
 *
 * This is the point of the page, not a formality: a reader who pastes a query
 * out of the docs and gets a syntax error learns that the documentation cannot
 * be trusted, and that costs more than having no example at all. The language
 * moves — this suite is what stops the prose from being left behind.
 *
 * Fences are therefore required to be *complete queries*, never fragments.
 * Syntax skeletons and clause diagrams belong in a ```text fence, which this
 * suite ignores.
 */

const CONTENT = new URL("content/docs", import.meta.url).pathname;

type Example = { file: string; line: number; query: string };

/** Every ```scoutql fence in the content tree, with where it came from. */
async function scoutQlExamples(): Promise<Example[]> {
  const files = [
    ...new Bun.Glob("**/*.{md,mdx}").scanSync({
      cwd: CONTENT,
      onlyFiles: true,
    }),
  ].sort();
  const examples: Example[] = [];
  for (const file of files) {
    const text = await Bun.file(path.join(CONTENT, file)).text();
    for (const found of text.matchAll(/^```scoutql\n(.*?)^```/gms)) {
      examples.push({
        file,
        line: text.slice(0, found.index).split("\n").length,
        query: (found[1] ?? "").trimEnd(),
      });
    }
  }
  return examples;
}

const examples = await scoutQlExamples();

describe("documented ScoutQL examples", () => {
  test("the content tree still carries examples to check", () => {
    // A refactor that renamed the fence language would otherwise turn this
    // whole suite into a no-op that passes.
    expect(examples.length).toBeGreaterThanOrEqual(20);
  });

  test("every example compiles", () => {
    const broken = examples.flatMap((example) => {
      try {
        compileScoutQl(example.query);
        return [];
      } catch (error) {
        return [
          `${example.file}:${example.line.toString()} — ${
            error instanceof Error ? error.message : String(error)
          }`,
        ];
      }
    });
    expect(broken).toEqual([]);
  });

  test("no example leans on a warning the prose does not explain", () => {
    // Examples are read as models. An unbounded window is legal and is
    // discussed at length in the reference, but nothing in the docs should
    // *demonstrate* one without saying so — a reader copies the shape, not
    // the caveat.
    const warned = examples.flatMap((example) => {
      const codes = lintScoutQl(example.query)
        .filter((diagnostic) => diagnostic.severity !== "error")
        .map((diagnostic) => diagnostic.code);
      return codes.length === 0
        ? []
        : [`${example.file}:${example.line.toString()} — ${codes.join(", ")}`];
    });
    expect(warned).toEqual([]);
  });

  test("no ScoutQL is fenced as sql", async () => {
    // ```sql renders through Shiki's SQL grammar, which knows nothing about
    // RENDER, player(), or kda() — it looks almost right, which is why the
    // fences drifted for so long before the tokenizer plugin existed.
    const files = [
      ...new Bun.Glob("**/*.{md,mdx}").scanSync({
        cwd: CONTENT,
        onlyFiles: true,
      }),
    ].sort();
    const offenders: string[] = [];
    for (const file of files) {
      const text = await Bun.file(path.join(CONTENT, file)).text();
      if (text.includes("```sql")) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
