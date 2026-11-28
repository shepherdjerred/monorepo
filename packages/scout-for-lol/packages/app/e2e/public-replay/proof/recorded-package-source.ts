import path from "node:path";
import { readReplayContainerIdentity } from "@scout-for-lol/replay/packets";
import { z } from "zod";
import { LocalScoutTerrainManifestSchema } from "#replay-e2e/local-scout-terrain-manifest.ts";

const StaticSceneSchema = z.looseObject({
  identity: z.strictObject({ build: z.string(), protocol: z.string() }),
  participants: z.never().optional(),
  frames: z.never().optional(),
});

export async function readRecordedPackageSource(
  manifestPath: string,
  roflPath: string,
) {
  const root = path.dirname(manifestPath);
  const sceneFile: Promise<unknown> = Bun.file(
    path.join(root, "scene.json"),
  ).json();
  const [manifest, replay, source] = await Promise.all([
    Bun.file(manifestPath).bytes(),
    Bun.file(roflPath).arrayBuffer(),
    sceneFile,
  ]);
  const inventory = LocalScoutTerrainManifestSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifest)),
  );
  const replaySha256 = Bun.CryptoHasher.hash(
    "sha256",
    new Uint8Array(replay),
    "hex",
  );
  const capabilities = inventory.capabilities;
  const recorded =
    capabilities.rosterCoverage === "recorded-replay"
      ? capabilities
      : undefined;
  let scene: unknown = source;
  if (recorded === undefined) {
    const authored = StaticSceneSchema.parse(source);
    const identity = readReplayContainerIdentity(replay);
    if (
      authored.identity.build !== identity.build ||
      authored.identity.protocol !== identity.protocol
    )
      throw new Error(
        "The build-scoped scene does not match the recorded replay build.",
      );
    scene = { ...authored, identity: { ...identity, replaySha256 } };
  }
  return {
    inventory,
    root,
    manifest,
    scene,
    replaySha256,
    recorded,
    replayBytes: replay.byteLength,
  };
}
