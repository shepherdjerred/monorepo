import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findTracingSafetyViolations } from "./check-workflow-tracing-safety.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(source: string): Promise<string> {
  const directory = await mkdtemp(
    path.join(tmpdir(), "temporal-tracing-safety-"),
  );
  await Bun.write(`${directory}/workflow.ts`, source);
  temporaryDirectories.push(directory);
  return directory;
}

describe("findTracingSafetyViolations", () => {
  test("rejects Query and Update definitions", async () => {
    const root = await fixture(
      'import { defineQuery, defineUpdate } from "@temporalio/workflow";',
    );
    await expect(findTracingSafetyViolations([root])).resolves.toEqual([
      { file: `${root}/workflow.ts`, rule: "query-update-handler" },
    ]);
  });

  test("rejects nondeterministic workflow UUIDs", async () => {
    const root = await fixture("export const id = crypto.randomUUID();");
    await expect(findTracingSafetyViolations([root])).resolves.toEqual([
      { file: `${root}/workflow.ts`, rule: "nondeterministic-uuid" },
    ]);
  });

  test("allows Temporal's deterministic uuid4", async () => {
    const root = await fixture(
      'import { uuid4 } from "@temporalio/workflow"; export const id = uuid4();',
    );
    await expect(findTracingSafetyViolations([root])).resolves.toEqual([]);
  });
});
