import { expect, test } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertScoutArchiveSource } from "./scout-archive.ts";
import { RELEASE_ENTRYPOINTS } from "./scout-release-entrypoints.ts";
import { PipelineDefinitionSchema } from "@shepherdjerred/delivery/contract";

test.each(["beta", "prod"] as const)(
  "publication and %s acceptance require the current site without the retired Activity",
  async (flavor) => {
    const root = await mkdtemp(path.join(tmpdir(), "scout-source-policy-"));
    try {
      for (const name of [
        "index.html",
        "app/index.html",
        "docs/index.html",
        "404.html",
      ]) {
        const file = path.join(root, name);
        await mkdir(path.dirname(file), { recursive: true });
        await Bun.write(file, "reviewed entrypoint");
      }
      expect(
        await Bun.file(path.join(root, "customs/index.html")).exists(),
      ).toBe(false);
      await assertScoutArchiveSource(root, flavor);
      const pipeline = PipelineDefinitionSchema.parse(
        await Bun.file(
          new URL(
            `../../../packages/delivery/registrations/specialized/scout-${flavor}/pipeline.json`,
            import.meta.url,
          ),
        ).json(),
      );
      if (pipeline.kind !== "argocd" || pipeline.scoutSite === undefined)
        throw new Error("Missing combined Scout release definition");
      expect(pipeline.scoutSite.entrypoints).toEqual([...RELEASE_ENTRYPOINTS]);
      for (const entrypoint of pipeline.scoutSite.entrypoints)
        expect(await Bun.file(path.join(root, entrypoint)).exists()).toBe(true);
      await Bun.file(path.join(root, "app/index.html")).delete();
      await expect(assertScoutArchiveSource(root, flavor)).rejects.toThrow(
        "app/index.html",
      );
    } finally {
      await rm(root, { recursive: true });
    }
  },
);
