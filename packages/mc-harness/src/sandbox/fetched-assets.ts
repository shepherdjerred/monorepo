import path from "node:path";
import { z } from "zod";

/**
 * A tracked manifest of files that are kept out of Git: each object is stored
 * once under its own SHA-256 at `<baseUrl>/<sha256><extension of path>` and
 * belongs at `path` beside the manifest. The Storm's baked navigation meshes
 * are the first use (`rwf/nav-manifest.json`).
 */
export const AssetManifestSchema = z.strictObject({
  baseUrl: z.string().regex(/^https?:\/\/[\w.:-]+(?:\/[\w.-]+)*$/u),
  objects: z.array(
    z.strictObject({
      path: z
        .string()
        .regex(/^[\w-][\w.-]*(?:\/[\w-][\w.-]*)*$/u, "Invalid asset path"),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      bytes: z.number().int().positive(),
    }),
  ),
});
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

export async function readAssetManifest(file: string): Promise<AssetManifest> {
  return AssetManifestSchema.parse(await Bun.file(file).json());
}

/** Hashes a file in chunks; the largest mesh is too big to buffer casually. */
export async function fileSha256(file: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(file).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

/** The manifest's paths whose file is absent or holds other bytes. */
export async function staleAssets(manifestFile: string): Promise<string[]> {
  const manifest = await readAssetManifest(manifestFile);
  const root = path.dirname(manifestFile);
  const stale: string[] = [];
  for (const object of manifest.objects) {
    const file = path.join(root, object.path);
    const handle = Bun.file(file);
    if (
      !(await handle.exists()) ||
      handle.size !== object.bytes ||
      (await fileSha256(file)) !== object.sha256
    )
      stale.push(object.path);
  }
  return stale;
}

/**
 * Makes every object of `manifest` present and exact. Nothing runs when the
 * files already hold the manifest's bytes; otherwise `fetch` materialises them
 * and the result is checked again, so a store that cannot serve an object
 * stops the caller instead of leaving it to run without the file.
 */
export async function ensureAssets(options: {
  manifest: string;
  fetch: readonly string[];
  cwd: string;
}): Promise<void> {
  const missing = await staleAssets(options.manifest);
  if (missing.length === 0) return;
  const child = Bun.spawn([...options.fetch], {
    cwd: options.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      OP_SERVICE_ACCOUNT_TOKEN: undefined,
      MC_BRIDGE_TOKEN: undefined,
    },
  });
  const [, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const commandLine = options.fetch.join(" ");
  if (code !== 0)
    throw new Error(
      `${commandLine} failed (${code.toString()}): ${stderr.trim()}`,
    );
  const stale = await staleAssets(options.manifest);
  if (stale.length > 0)
    throw new Error(
      `${commandLine} left ${stale.length.toString()} of ${options.manifest} missing or altered: ${stale.join(", ")}`,
    );
}
