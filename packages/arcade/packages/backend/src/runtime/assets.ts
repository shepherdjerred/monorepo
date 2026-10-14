import path from "node:path";
import { z } from "zod";

export const AssetManifestSchema = z.strictObject({
  version: z.literal(1),
  gameId: z.enum(["mkwii", "melee", "brawl"]),
  sourceRevision: z.string().regex(/^[a-f\d]{40}$/),
  files: z
    .array(
      z.strictObject({
        path: z
          .string()
          .min(1)
          .refine(
            (name) =>
              !path.isAbsolute(name) && !name.split(/[\\/]/).includes(".."),
          ),
        sha256: z.string().regex(/^[a-f\d]{64}$/),
      }),
    )
    .min(1),
});

/** Private assets are immutable while a session owns them. Hash before execution. */
export async function verifyAssets(
  root: string,
  gameId: "mkwii" | "melee" | "brawl",
  sourceRevision: string,
): Promise<void> {
  const manifest = AssetManifestSchema.parse(
    await Bun.file(path.join(root, "arcade-assets.json")).json(),
  );
  if (manifest.gameId !== gameId || manifest.sourceRevision !== sourceRevision)
    throw new Error("Private assets do not match this Arcade runtime");
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (paths.has(file.path)) throw new Error("Duplicate private asset entry");
    paths.add(file.path);
    const hasher = new Bun.CryptoHasher("sha256");
    for await (const block of Bun.file(path.join(root, file.path)).stream())
      hasher.update(block);
    if (hasher.digest("hex") !== file.sha256)
      throw new Error(`Private asset checksum differs: ${file.path}`);
  }
  const required =
    gameId === "melee"
      ? ["disc.iso", "engine/melee_browser.wasm"]
      : gameId === "brawl"
        ? ["disc.wbfs"]
        : ["main.js", "products.json"];
  for (const file of required)
    if (!paths.has(file))
      throw new Error(`Missing required private asset: ${file}`);
  if (gameId === "mkwii") await verifyWiiProduct(root, paths);
}

async function verifyWiiProduct(
  root: string,
  paths: ReadonlySet<string>,
): Promise<void> {
  const products = z
    .array(
      z.looseObject({ id: z.string(), glue: z.string(), wasm: z.string() }),
    )
    .parse(await Bun.file(path.join(root, "products.json")).json());
  const product = products.find((entry) => entry.id === "WiiCompiled");
  if (product === undefined)
    throw new Error("Wii assets have no base game product");
  for (const file of [product.glue, product.wasm])
    if (!paths.has(file))
      throw new Error(
        `Wii product is outside the verified asset manifest: ${file}`,
      );
}
