import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { compileBuild, renderBuild, runBuild } from "#build/commands.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { Journal } from "#build/journal.ts";
import { producingProgram, readProgramText } from "#build/sidecar.ts";
import { pickCandidate, saveCandidate } from "#build/studio/candidates.ts";
import { readProgramSnapshot } from "#build/storage/program-evidence.ts";
import { BUILD_FILES } from "#protocol/build.ts";
import { flatSiteBuild } from "#test/fixtures/flat-site.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "mc-program-evidence-"));
afterAll(async () => rm(root, { recursive: true }));
const text = `import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";
export default ((ctx) => { ctx.set(1, 1, 1, "minecraft:stone"); }) satisfies BuildProgram;
`;

async function fixture(name: string) {
  const workspace = await flatSiteBuild(path.join(root, name), name);
  await Bun.write(workspace.file(BUILD_FILES.program), text);
  await compileBuild(workspace.dir);
  const { ops } = await workspace.oplog();
  const file = await producingProgram(workspace, ops);
  if (file === null) throw new Error("compile did not retain its program");
  return { workspace, file };
}

describe("compile-bound producing programs", () => {
  it("keeps original compiled text after edits and restores a self-contained candidate", async () => {
    const { workspace, file } = await fixture("valid");
    await Bun.write(workspace.file(BUILD_FILES.program), "later working text");
    expect(await readProgramText(workspace, file)).toBe(text);
    await saveCandidate(workspace.dir, "saved");
    await rm(workspace.file(file));
    await pickCandidate(workspace.dir, "saved");
    expect(await Bun.file(workspace.file(BUILD_FILES.program)).text()).toBe(
      text,
    );
  });

  it.each(["program", "output", "missing-record", "invalid-record"])(
    "rejects %s corruption before render, candidate publication or sandbox mutations",
    async (failure) => {
      const { workspace, file } = await fixture(failure);
      const record = file.replace(/\.build\.ts$/u, ".json");
      if (failure === "missing-record") await rm(workspace.file(record));
      else
        await Bun.write(
          workspace.file(
            failure === "program"
              ? file
              : failure === "output"
                ? file.replace(/\.build\.ts$/u, ".schem")
                : record,
          ),
          "corrupted",
        );
      await expect(readProgramSnapshot(workspace, file)).rejects.toThrow();
      const manifest = await workspace.manifest();
      await workspace.writeManifest({ ...manifest, canvas: "sbx-000001" });
      const client = new DaemonClient();
      const we = vi.spyOn(client, "we");
      const paste = vi.spyOn(client, "paste");
      const env = {
        client,
        journal: new Journal(workspace.file("audit")),
        log: vi.fn(),
      };
      await expect(runBuild(env, workspace.dir, {})).rejects.toThrow();
      await expect(
        renderBuild(env, workspace.dir, { source: "compiled", name: "bad" }),
      ).rejects.toThrow();
      await expect(saveCandidate(workspace.dir, "bad")).rejects.toThrow();
      expect(we).not.toHaveBeenCalled();
      expect(paste).not.toHaveBeenCalled();
      expect(await Bun.file(workspace.file("renders/bad.json")).exists()).toBe(
        false,
      );
      expect(
        await Bun.file(
          workspace.file("candidates/bad/candidate.json"),
        ).exists(),
      ).toBe(false);
    },
  );

  it("rejects program operations that no longer match their compile evidence", async () => {
    const { workspace } = await fixture("changed-ops");
    const { ops } = await workspace.oplog();
    let changed = false;
    const edited = ops.map((op) => {
      if (!changed && op.kind === "paste") {
        changed = true;
        return { ...op, at: { ...op.at, x: op.at.x + 1 } };
      }
      return op;
    });
    expect(changed).toBe(true);
    await workspace.writeOplog({ version: 1, ops: edited });
    await expect(producingProgram(workspace, edited)).rejects.toThrow(
      /operation set does not match/u,
    );
  });
});
