/**
 * Signed skin textures: reused from a previous output directory or a local
 * texture cache when the pixels match, otherwise signed through MineSkin.
 * Nothing here ever fabricates a value or signature.
 */
import path from "node:path";
import { z } from "zod";
import type { MineSkin } from "./mineskin.ts";
import {
  IdentitySchema,
  ManifestSchema,
  type Manifest,
  type Personality,
} from "./schema.ts";

export type Previous = {
  manifest: Manifest;
  skins: Map<string, Personality["skin"]>;
};

/** A previous run's output, for reusing its signed textures. */
export async function loadPrevious(directory: string): Promise<Previous> {
  const manifest = ManifestSchema.parse(
    await Bun.file(path.join(directory, "manifest.json")).json(),
  );
  const skins = new Map<string, Personality["skin"]>();
  for (const entry of manifest.personalities) {
    const yaml = await Bun.file(path.join(directory, `${entry.id}.yml`)).text();
    skins.set(entry.id, IdentitySchema.parse(Bun.YAML.parse(yaml)).skin);
  }
  return { manifest, skins };
}

const CachedTextureSchema = z.strictObject({
  value: z.string().min(1),
  signature: z.string().min(1),
  mineskinUuid: z.string(),
  textureUrl: z.url(),
});
type CachedTexture = z.infer<typeof CachedTextureSchema>;
const TextureCacheSchema = z.record(
  z.string().regex(/^[0-9a-f]{64}$/),
  CachedTextureSchema,
);

export type Signer = {
  previous: Previous | undefined;
  /** Signed textures by skin PNG sha256, so a re-run never signs a skin twice. */
  cache: Map<string, CachedTexture>;
  /** Where the cache is persisted after every signing, if anywhere. */
  cacheFile: string | undefined;
  mineskin: MineSkin | undefined;
};

/** The texture cache in `file`, empty when there is no file yet. */
export async function loadTextureCache(
  file: string | undefined,
): Promise<Map<string, CachedTexture>> {
  return file === undefined || !(await Bun.file(file).exists())
    ? new Map()
    : new Map(
        Object.entries(TextureCacheSchema.parse(await Bun.file(file).json())),
      );
}

export type UnsignedSkin = {
  id: string;
  name: string;
  png: Uint8Array<ArrayBuffer>;
  skinSha256: string;
};

export type SignedSkin = {
  skin: Personality["skin"];
  mineskinUuid: string;
  textureUrl: string;
  reused: boolean;
};

/**
 * The signed texture for a skin: reused from a previous run when the id and
 * pixel hash match, or from the texture cache when the pixels match, otherwise
 * freshly signed through MineSkin. Offline runs fail when nothing matches.
 */
export async function signSkin(
  signer: Signer,
  unsigned: UnsignedSkin,
  progress: string,
): Promise<SignedSkin> {
  const cached = signer.previous?.manifest.personalities.find(
    (entry) =>
      entry.id === unsigned.id && entry.skinSha256 === unsigned.skinSha256,
  );
  const cachedSkin = signer.previous?.skins.get(unsigned.id);
  if (cached !== undefined && cachedSkin !== undefined) {
    return {
      skin: cachedSkin,
      mineskinUuid: cached.mineskinUuid,
      textureUrl: cached.textureUrl,
      reused: true,
    };
  }
  const fromCache = signer.cache.get(unsigned.skinSha256);
  if (fromCache !== undefined) {
    return {
      skin: { value: fromCache.value, signature: fromCache.signature },
      mineskinUuid: fromCache.mineskinUuid,
      textureUrl: fromCache.textureUrl,
      reused: true,
    };
  }
  if (signer.mineskin === undefined) {
    throw new Error(
      `--offline needs a signed texture for ${unsigned.id} in --skins-from or --texture-cache; none matched its skin`,
    );
  }
  console.error(`  skin ${unsigned.id}: asking MineSkin (${progress})`);
  const texture = await signer.mineskin.generate(unsigned.png, unsigned.name);
  const signed: CachedTexture = {
    value: texture.value,
    signature: texture.signature,
    mineskinUuid: texture.mineskinUuid,
    textureUrl: texture.textureUrl,
  };
  signer.cache.set(unsigned.skinSha256, signed);
  if (signer.cacheFile !== undefined) {
    await Bun.write(
      signer.cacheFile,
      `${JSON.stringify(Object.fromEntries(signer.cache), null, 2)}\n`,
    );
  }
  return {
    skin: { value: signed.value, signature: signed.signature },
    mineskinUuid: signed.mineskinUuid,
    textureUrl: signed.textureUrl,
    reused: false,
  };
}
