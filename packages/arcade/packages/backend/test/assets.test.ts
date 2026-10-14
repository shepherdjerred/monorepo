import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AssetManifestSchema, verifyAssets } from "#src/runtime/assets.ts";

describe("private assets", () => {
  it("verifies the hashed Wii WASM filename selected by the upstream product catalog", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "arcade-products-"));
    const revision = "b19270fb9c1590673528a52d34ce4afb780cbee5";
    const files = new Map([
      ["main.js", "site"],
      ["WiiCompiled.js", "glue"],
      ["WiiCompiled.01234567.wasm", "private-wasm"],
      [
        "products.json",
        JSON.stringify([
          {
            id: "WiiCompiled",
            glue: "WiiCompiled.js",
            wasm: "WiiCompiled.01234567.wasm",
          },
        ]),
      ],
    ]);
    try {
      for (const [name, contents] of files)
        await Bun.write(path.join(root, name), contents);
      await Bun.write(
        path.join(root, "arcade-assets.json"),
        JSON.stringify({
          version: 1,
          gameId: "mkwii",
          sourceRevision: revision,
          files: [...files].map(([name, contents]) => ({
            path: name,
            sha256: new Bun.CryptoHasher("sha256")
              .update(contents)
              .digest("hex"),
          })),
        }),
      );
      await verifyAssets(root, "mkwii", revision);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
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
