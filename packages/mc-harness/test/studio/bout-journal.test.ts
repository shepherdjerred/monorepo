import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import type * as FileTransaction from "#build/file-transaction.ts";
import { appendLog, readLog } from "#build/build-log.ts";
import {
  publishBoutState,
  type OutcomeInput,
} from "#build/studio/bout-publication.ts";
import { flatSiteBuild } from "#test/fixtures/flat-site.ts";

const beforeLock = vi.hoisted(() => {
  const state: { action: (() => Promise<void>) | null } = { action: null };
  return state;
});
vi.mock("#build/file-transaction.ts", async (importOriginal) => {
  const original = await importOriginal<typeof FileTransaction>();
  return {
    ...original,
    publishFiles: async (...args: Parameters<typeof original.publishFiles>) => {
      const action = beforeLock.action;
      beforeLock.action = null;
      await action?.();
      return original.publishFiles(...args);
    },
  };
});
const root = await mkdtemp(path.join(tmpdir(), "mc-bout-journal-"));
afterAll(async () => rm(root, { recursive: true }));

it("retains an intervening render and stamps the bout from the locked journal", async () => {
  const workspace = await flatSiteBuild(path.join(root, "bout"), "bout");
  const manifest = await workspace.manifest();
  const outcome: OutcomeInput = {
    kind: "accept",
    candidate: "one",
    versus: null,
    file: null,
    rubric: "micro",
    gridHash: "grid",
    critique: "judge/critique.json",
    score: 20,
  };
  beforeLock.action = async () => {
    await appendLog(workspace.dir, {
      kind: "render",
      name: "intervening",
      source: "compiled",
      files: [],
    });
  };
  await publishBoutState(workspace, { manifest, outcomes: [outcome] });
  expect(await readLog(workspace.dir)).toMatchObject([
    { kind: "render", name: "intervening", iteration: 1 },
    { kind: "accept", candidate: "one", iteration: 1 },
  ]);
  const journal = await readLog(workspace.dir);
  await publishBoutState(workspace, { manifest, outcomes: [outcome] });
  expect(await readLog(workspace.dir)).toEqual(journal);
});
