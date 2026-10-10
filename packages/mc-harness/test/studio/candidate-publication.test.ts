import { mkdtemp, readdir, rm } from "node:fs/promises";
import type * as FileSystem from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it, vi } from "vitest";
import { flatSiteBuild, clearFloorOp } from "#test/fixtures/flat-site.ts";
import {
  saveCandidate,
  readCandidate,
  listCandidates,
} from "#build/studio/candidates.ts";
import { readLog } from "#build/build-log.ts";
import { BUILD_FILES, CANDIDATE_FILES } from "#protocol/build.ts";

const failure = vi.hoisted(() => ({ kind: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return {
    ...original,
    appendFile: async (...args: Parameters<typeof original.appendFile>) => {
      if (failure.kind === "journal-stage") {
        failure.kind = "";
        throw new Error("simulated candidate journal staging failure");
      }
      return original.appendFile(...args);
    },
    rename: async (...args: Parameters<typeof original.rename>) => {
      const from = String(args[0]);
      if (
        from.includes(".candidate-") &&
        ((failure.kind === "journal-install" &&
          from.endsWith(`/${BUILD_FILES.journal}`)) ||
          (failure.kind === "candidate-install" &&
            from.endsWith("/candidates/saved")))
      ) {
        failure.kind = "";
        throw new Error("simulated candidate installation failure");
      }
      return original.rename(...args);
    },
  };
});

const root = await mkdtemp(path.join(tmpdir(), "mc-candidate-publication-"));
afterAll(async () => rm(root, { recursive: true }));

describe("candidate save publication", () => {
  it.each(
    [false, true].flatMap((force) =>
      [
        "journal-stage",
        "journal-install",
        "candidate-install",
        "malformed",
      ].map((kind) => ({ force, kind })),
    ),
  )(
    "preserves the previous candidate and journal after $kind (force: $force)",
    async ({ force, kind }) => {
      const name = `${kind}-${String(force)}`;
      const workspace = await flatSiteBuild(path.join(root, name), name);
      await workspace.writeOplog({ version: 1, ops: [clearFloorOp(1)] });
      const old = force ? await saveCandidate(workspace.dir, "saved") : null;
      const grid = workspace.file(`candidates/saved/${CANDIDATE_FILES.grid}`);
      const bytes = old === null ? null : await Bun.file(grid).bytes();
      const journal = workspace.file(BUILD_FILES.journal);
      const cleanJournal = (await Bun.file(journal).exists())
        ? await Bun.file(journal).text()
        : "";
      if (kind === "malformed") await Bun.write(journal, "invalid journal\n");
      const before = (await Bun.file(journal).exists())
        ? await Bun.file(journal).text()
        : "";
      await workspace.writeOplog({ version: 1, ops: [clearFloorOp(2)] });
      if (kind !== "malformed") failure.kind = kind;
      await expect(
        saveCandidate(workspace.dir, "saved", { force }),
      ).rejects.toThrow();
      const after = (await Bun.file(journal).exists())
        ? await Bun.file(journal).text()
        : "";
      expect(after).toBe(before);
      if (kind === "malformed") await Bun.write(journal, cleanJournal);
      if (old === null) expect(await listCandidates(workspace.dir)).toEqual([]);
      else {
        expect(await readCandidate(workspace.dir, "saved")).toEqual(old);
        expect(await Bun.file(grid).bytes()).toEqual(bytes);
      }
      const files = await readdir(workspace.dir);
      expect(files.some((file) => file.startsWith(".candidate-"))).toBe(false);
      const saved = await saveCandidate(workspace.dir, "saved", { force });
      expect(saved.gridHash).not.toBe(old?.gridHash);
      const entries = await readLog(workspace.dir);
      const saves = entries.filter(
        (entry) => entry.kind === "candidate" && entry.action === "save",
      );
      expect(saves).toHaveLength(force ? 2 : 1);
    },
  );
});
