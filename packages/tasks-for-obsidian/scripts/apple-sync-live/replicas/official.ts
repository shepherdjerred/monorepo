import path from "node:path";
import { z } from "zod";
import { digest, runDirectory, type Manifest } from "../model";
import {
  assertOfficialPluginAssets,
  inspectOfficialPlugin,
  officialPluginAssets,
  officialPluginRelease,
} from "../official-plugin";
import { command } from "../platform";
import { requestGuest } from "../transport/client";
import { readVaultFiles } from "./access";

export async function currentOfficialPlugin(manifest: Manifest) {
  if (manifest.schemaVersion !== 3)
    return inspectOfficialPlugin(
      path.join(
        runDirectory(manifest.runID),
        "reference-vault/.obsidian/plugins/tasknotes",
      ),
    );
  const prefix = ".obsidian/plugins/tasknotes/";
  const names = Object.keys(officialPluginAssets);
  const files = await readVaultFiles(
    manifest,
    "official",
    names.map((name) => prefix + name),
  );
  const assets = Object.fromEntries(
    names.map((name) => {
      const bytes = files[prefix + name];
      if (bytes === undefined)
        throw new Error("Guest omitted a pinned official plugin asset");
      return [name, { size: bytes.length, sha256: digest(bytes) }];
    }),
  );
  assertOfficialPluginAssets(assets);
  const plugin = z
    .object({
      id: z.literal("tasknotes"),
      version: z.literal(officialPluginRelease.version),
    })
    .parse(
      JSON.parse(new TextDecoder().decode(files[prefix + "manifest.json"])),
    );
  return {
    release: officialPluginRelease,
    id: plugin.id,
    assets: z
      .strictObject({
        "main.js": z.object({ size: z.number(), sha256: z.string() }),
        "manifest.json": z.object({ size: z.number(), sha256: z.string() }),
        "styles.css": z.object({ size: z.number(), sha256: z.string() }),
      })
      .parse(assets),
  };
}

export async function currentOfficialVersion(manifest: Manifest) {
  if (manifest.schemaVersion === 3) {
    const result = await requestGuest(manifest, { kind: "official-info" });
    if (result.kind !== "official-info")
      throw new Error("Wrong guest official response");
    return z.string().min(1).max(64).parse(result.officialVersion);
  }
  return command([
    "plutil",
    "-extract",
    "CFBundleShortVersionString",
    "raw",
    "-o",
    "-",
    "/Applications/Obsidian.app/Contents/Info.plist",
  ]);
}
