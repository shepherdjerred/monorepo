import { expect, test } from "vitest";
import {
  NATIVE_REVIEW_STATES,
  REVIEW_STATE,
  reviewState,
} from "./vocabulary.ts";

async function serverFiles(): Promise<string[]> {
  const root = new URL("../../", import.meta.url).pathname;
  const files: string[] = [];
  for await (const file of new Bun.Glob("**/*.ts").scan({ cwd: root })) {
    if (/\.(?:test|integration\.test)\.ts$|test-|testing\//u.test(file)) {
      continue;
    }
    files.push(`${root}${file}`);
  }
  return files;
}

/**
 * The states the server writes onto a native recovery plan, of every kind
 * (file recovery, quarantine, archive, compensation, series pack): the
 * column's default and every `state:` literal in a plan create or update.
 */
async function serverStates(): Promise<string[]> {
  const states = new Set<string>();
  const schema = await Bun.file(
    new URL("../../../prisma/schema.prisma", import.meta.url),
  ).text();
  const model =
    /model NativeRecoveryPlan \{[\s\S]*?\n\}/u.exec(schema)?.[0] ?? "";
  for (const found of model.matchAll(/state String @default\("(\w+)"\)/gu)) {
    states.add(found[1] ?? "");
  }
  for (const file of await serverFiles()) {
    const text = await Bun.file(file).text();
    for (const call of text.matchAll(
      /nativeRecoveryPlan\.(?:update|updateMany|create)\(/gu,
    )) {
      const window = text.slice(call.index, call.index + 900);
      for (const found of window.matchAll(/\bstate:\s*"(\w+)"/gu)) {
        states.add(found[1] ?? "");
      }
    }
  }
  return [...states].sort();
}

test("the page words exactly the review states the server writes", async () => {
  expect([...NATIVE_REVIEW_STATES].sort()).toEqual(await serverStates());
  expect(Object.keys(REVIEW_STATE).sort()).toEqual(
    [...NATIVE_REVIEW_STATES].sort(),
  );
});

test("a state the server does not write is refused, not shown", () => {
  expect(() => reviewState("requires_review")).toThrow();
  expect(reviewState("awaiting_review")).toBe("awaiting_review");
});
