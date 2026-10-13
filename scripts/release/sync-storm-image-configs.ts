import path from "node:path";
import { format } from "prettier";
import { z } from "zod";
import { parseVersionCatalogSource } from "../lib/pin-candidates.ts";
import {
  readStormImageConfig,
  snapshotStormImageConfig,
} from "../lib/storm-image-config.ts";

export const STORM_IMAGE_CONFIGS_PATH =
  "packages/mc-harness/src/sandbox/storm-image-configs.json";
export const VERSION_CATALOG_FILE_REL =
  "packages/version-catalog/src/catalog.json";
export const PIN_STATE_FILE_REL = "scripts/pin-candidates-state.json";
const SnapshotSchema = z
  .object({
    configSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    moduleKeys: z
      .array(z.string().min(1))
      .nonempty()
      .refine((keys) => new Set(keys).size === keys.length),
  })
  .strict();

/** Keep both independently moving pins coupled to verified image config, in the same commit. */
export async function syncStormImageConfigs(
  root: string,
  catalogSource: string,
  readConfig: (digest: string) => Promise<Uint8Array> = readStormImageConfig,
): Promise<void> {
  const catalog = parseVersionCatalogSource(catalogSource);
  const file = Bun.file(path.join(root, STORM_IMAGE_CONFIGS_PATH));
  const existing = (await file.exists())
    ? z
        .record(z.string().regex(/^[a-f0-9]{64}$/u), SnapshotSchema)
        .parse(await file.json())
    : {};
  const snapshots: Record<string, z.infer<typeof SnapshotSchema>> = {};
  for (const key of [
    "shepherdjerred/the-storm-server",
    "shepherdjerred/the-storm-server/prod",
  ]) {
    const value = catalog.get(key);
    const digest =
      value === undefined
        ? undefined
        : /@sha256:([a-f0-9]{64})$/u.exec(value)?.[1];
    if (digest === undefined) throw new Error(`Missing digest pin for ${key}`);
    snapshots[digest] =
      existing[digest] ??
      snapshotStormImageConfig(await readConfig(`sha256:${digest}`));
  }
  await Bun.write(
    file,
    await format(JSON.stringify(snapshots), { parser: "json" }),
  );
}

export async function writeVersionPinUpdate(
  root: string,
  catalogSource: string,
  pinStateSource: string,
  git: (args: string[]) => Promise<unknown>,
): Promise<void> {
  await syncStormImageConfigs(root, catalogSource);
  await Bun.write(path.join(root, VERSION_CATALOG_FILE_REL), catalogSource);
  await Bun.write(path.join(root, PIN_STATE_FILE_REL), pinStateSource);
  await git([
    "add",
    VERSION_CATALOG_FILE_REL,
    PIN_STATE_FILE_REL,
    STORM_IMAGE_CONFIGS_PATH,
  ]);
}

if (import.meta.main) {
  const root = new URL("../..", import.meta.url).pathname;
  await syncStormImageConfigs(
    root,
    await Bun.file(path.join(root, VERSION_CATALOG_FILE_REL)).text(),
  );
}
