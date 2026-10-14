import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AssetManifestSchema, verifyAssets } from "#src/runtime/assets.ts";

describe("private assets", () => {
  it("rejects traversal and detects altered data before executing the runtime", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "arcade-assets-"));
    const revision = "2614969fa80dfeb87d2a4ad3bdaa703237127074";
    const manifest = {
      version: 1,
      gameId: "brawl",
      sourceRevision: revision,
      files: [
        {
          path: "disc.wbfs",
          sha256: new Bun.CryptoHasher("sha256")
            .update("fixture")
            .digest("hex"),
        },
      ],
    };
    try {
      await Bun.write(path.join(root, "disc.wbfs"), "fixture");
      await Bun.write(
        path.join(root, "arcade-assets.json"),
        JSON.stringify(manifest),
      );
      await verifyAssets(root, "brawl", revision);
      await expect(verifyAssets(root, "brawl", "0".repeat(40))).rejects.toThrow(
        "match",
      );
      await Bun.write(path.join(root, "disc.wbfs"), "changed");
      await expect(verifyAssets(root, "brawl", revision)).rejects.toThrow(
        "checksum",
      );
      expect(
        AssetManifestSchema.safeParse({
          ...manifest,
          files: [{ ...manifest.files[0], path: "../disc.wbfs" }],
        }).success,
      ).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
