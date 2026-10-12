import { readdir } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import ts from "typescript";
import { lessonRoot, loadArticleSource } from "#lib/article.ts";
import { checkStep } from "#lib/render.ts";

it("checks every numbered snapshot together with strict TypeScript", async () => {
  const files = await readdir(lessonRoot);
  const names = files.filter((name) => /^\d.*\.tsx?$/.test(name));
  expect(names).toHaveLength(52);
  const program = ts.createProgram(
    [
      ...names.map((name) => path.resolve(lessonRoot, name)),
      path.resolve(lessonRoot, "jsx.d.ts"),
    ],
    {
      strict: true,
      noEmit: true,
      types: [],
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => lessonRoot,
      getCanonicalFileName: (file) => file,
      getNewLine: () => "\n",
    }),
  ).toBe("");
}, 30_000);

it("checks all inline examples, including code embedded in prose", async () => {
  const article = await loadArticleSource();
  expect(article.examples).toHaveLength(12);
  for (const example of article.examples)
    expect(checkStep(example).errors).toEqual([]);
}, 30_000);
