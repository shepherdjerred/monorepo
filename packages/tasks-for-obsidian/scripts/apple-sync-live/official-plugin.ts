import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { digest, FileSchema } from "./model";

// Official GitHub release asset identities and API SHA-256 digests, verified
// from release 402162287. These pins are independent of the editable manifest.
export const officialPluginRelease = {
  id: 402_162_287,
  version: "4.13.8",
  url: "https://github.com/callumalpass/tasknotes/releases/tag/4.13.8",
} as const;
export const officialPluginAssets = {
  "main.js": {
    size: 4_544_257,
    sha256: "ba429c5476048d4bc5ffa53068d803f11c79b3f6af24cc407a09e98c85bea092",
  },
  "manifest.json": {
    size: 306,
    sha256: "c40b0e32365e7fcd793345f5da043d9c5dc325d662c05a4c88690e08cdf452e1",
  },
  "styles.css": {
    size: 611_855,
    sha256: "78b552593f5ebdd3dffdedfe3eee88e05a43e785e82db07660029a788f763546",
  },
} as const;
const AssetsSchema = z.strictObject({
  "main.js": FileSchema,
  "manifest.json": FileSchema,
  "styles.css": FileSchema,
});

export function assertOfficialPluginAssets(value: unknown): void {
  const actual = AssetsSchema.parse(value);
  for (const filename of ["main.js", "manifest.json", "styles.css"] as const) {
    const expected = officialPluginAssets[filename];
    if (
      actual[filename].size !== expected.size ||
      actual[filename].sha256 !== expected.sha256
    )
      throw new Error(`Installed official plugin asset changed: ${filename}`);
  }
}

export async function inspectOfficialPlugin(directory: string) {
  if ((await realpath(directory)) !== directory)
    throw new Error("Unsafe official plugin directory");
  const assets: Record<string, z.infer<typeof FileSchema>> = {};
  for (const [filename, expected] of Object.entries(officialPluginAssets)) {
    const target = path.join(directory, filename);
    const stat = await lstat(target);
    if ((await realpath(target)) !== target || !stat.isFile())
      throw new Error("Unsafe official plugin asset");
    if (stat.size !== expected.size)
      throw new Error(`Installed official plugin asset changed: ${filename}`);
    assets[filename] = {
      size: stat.size,
      sha256: digest(await readFile(target)),
    };
  }
  assertOfficialPluginAssets(assets);
  const manifest = z
    .object({
      id: z.literal("tasknotes"),
      version: z.literal(officialPluginRelease.version),
    })
    .parse(await Bun.file(path.join(directory, "manifest.json")).json());
  return {
    release: officialPluginRelease,
    id: manifest.id,
    assets: AssetsSchema.parse(assets),
  };
}

export function assertSealedOfficialPlugin(
  sealed: unknown,
  current: Awaited<ReturnType<typeof inspectOfficialPlugin>>,
) {
  const previous = z
    .strictObject({
      release: z.strictObject({
        id: z.literal(officialPluginRelease.id),
        version: z.literal(officialPluginRelease.version),
        url: z.literal(officialPluginRelease.url),
      }),
      id: z.literal("tasknotes"),
      assets: AssetsSchema,
    })
    .parse(sealed);
  assertOfficialPluginAssets(previous.assets);
  if (JSON.stringify(previous) !== JSON.stringify(current))
    throw new Error("Sealed official plugin evidence changed");
}
