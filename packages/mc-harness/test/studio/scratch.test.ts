import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createScratch } from "#build/scratch.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import { BUILD_FILES } from "#protocol/build.ts";
import { flatSiteBuild } from "#test/fixtures/flat-site.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "mc-scratch-"));
afterAll(async () => rm(root, { recursive: true }));

describe("scratch publication", () => {
  it("does not leave a partial build when the parent journal is invalid", async () => {
    const workspace = await flatSiteBuild(
      path.join(root, "invalid-journal"),
      "invalid-journal",
    );
    await Bun.write(workspace.file(BUILD_FILES.journal), "malformed\n");

    await expect(createScratch(workspace.dir, { size: 8 })).rejects.toThrow();

    expect(
      await Bun.file(workspace.file(BUILD_FILES.scratchDir)).exists(),
    ).toBe(false);
    expect(await Bun.file(workspace.file(BUILD_FILES.journal)).text()).toBe(
      "malformed\n",
    );
  });

  it("publishes the scratch directory and its parent note together", async () => {
    const workspace = await flatSiteBuild(
      path.join(root, "published"),
      "published",
    );
    const scratch = await createScratch(workspace.dir, { size: 8 });

    expect(await new BuildWorkspace(scratch.dir).manifest()).toMatchObject({
      name: "published-pad",
    });
    expect(
      await Bun.file(workspace.file(BUILD_FILES.journal)).text(),
    ).toContain("scratch pad scratch/");
  });
});
