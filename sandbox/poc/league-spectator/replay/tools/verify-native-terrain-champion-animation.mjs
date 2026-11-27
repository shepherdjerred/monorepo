// Audit authored animations for the exact replay-selected skins using saved files.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { archivedAnimationFormat } from "./archived-animation-format.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
import {
  archivedChampionBuild,
  championArchiveExecutableHashes,
  currentChampionBuild,
} from "./research/native-terrain-champion-model-catalog.mjs";
import { openLocalWad } from "./wad.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hex = (value) => value.toString(16).padStart(8, "0");
const field = (node, name) => node?.fields[mapBinHash(name)];
export async function auditChampionAnimation(
  installation,
  manifestPath,
  replayBytes,
  nameProbes,
  { includeEvents = false, allowCurrentBuild = false } = {},
) {
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  const executableSha256 = hash(
    await readFile(join(installation, "Game", "League of Legends.exe")),
  );
  const replaySha256 = hash(replayBytes);
  const current = allowCurrentBuild && manifest.build === currentChampionBuild;
  const selected =
    current && manifest.nativeOpening?.replaySha256 === replaySha256
      ? manifest.nativeOpening.rows.map(({ context, champion, skinId }) => ({
          ...manifest.skins.find(
            (skin) => skin.champion === champion && skin.skinId === skinId,
          ),
          context,
        }))
      : manifest.actors;
  if (
    manifest.schema !== 1 ||
    (!current && manifest.build !== archivedChampionBuild) ||
    executableSha256 !== championArchiveExecutableHashes[manifest.build] ||
    manifest.installedExeSha256 !== executableSha256 ||
    (current ? manifest.nativeOpening?.replaySha256 : manifest.replaySha256) !==
      replaySha256 ||
    selected?.length !== 10 ||
    new Set(selected.map(({ context }) => context)).size !== 10
  )
    throw Error("Exact ten-participant champion provenance required");

  const actors = [];
  for (const actor of selected) {
    const { champion, skinId, context, rootPath, resources, archive } = actor;
    if (
      !/^[A-Za-z0-9_]+$/.test(champion) ||
      !Number.isSafeInteger(skinId) ||
      skinId < 0 ||
      archive !== `DATA/FINAL/Champions/${champion}.wad.client` ||
      rootPath !== `Characters/${champion}/Skins/Skin${skinId}` ||
      resources.skin.file !== `${champion.toLowerCase()}-${skinId}/skin.bin`
    )
      throw Error("Unsafe or inconsistent champion identity");
    const read = await openLocalWad(
      installation,
      archive,
      Bun.zstdDecompressSync,
    );
    const skinPath = `data/${rootPath.toLowerCase()}.bin`;
    const skinBytes = await read(skinPath);
    const skinSha256 = hash(skinBytes);
    if (
      resources.skin.reference !== skinPath ||
      resources.skin.bytes !== skinBytes.byteLength ||
      resources.skin.sha256 !== skinSha256 ||
      hash(await readFile(join(dirname(manifestPath), resources.skin.file))) !==
        skinSha256
    )
      throw Error(`Exact skin digest mismatch for ${rootPath}`);

    const skin = readExactMapBin(skinBytes);
    const root = skin.objects.find(
      (node) => node.pathHash === mapBinHash(rootPath),
    );
    if (root?.classHash !== mapBinHash("SkinCharacterDataProperties"))
      throw Error(`Missing original skin root ${rootPath}`);
    const graphLink = field(
      field(root, "skinAnimationProperties"),
      "animationGraphData",
    );
    if (graphLink?.type !== "ObjectLink")
      throw Error(`Missing authored animation graph link for ${rootPath}`);
    const graphHash = hex(graphLink.value);
    const sources = new Set([skinPath]);
    const queue = [...skin.dependencies];
    const graphs = [];
    const collect = (tree, path, bytes) => {
      for (const node of tree.objects)
        if (node.pathHash === graphHash) graphs.push({ node, path, bytes });
    };
    collect(skin, skinPath, skinBytes);
    for (const dependency of queue) {
      const path = dependency.toLowerCase();
      if (sources.has(path)) continue;
      if (sources.size >= 128)
        throw Error("Animation BIN dependency limit exceeded");
      const bytes = await read(path);
      const bin = readExactMapBin(bytes);
      sources.add(path);
      collect(bin, path, bytes);
      queue.push(...bin.dependencies);
    }
    if (
      graphs.length !== 1 ||
      graphs[0].node.classHash !== mapBinHash("AnimationGraphData")
    )
      throw Error(
        `Unresolved or ambiguous authored animation graph for ${rootPath}`,
      );
    const [{ node, bytes, path }] = graphs;
    const clipMap = field(node, "mClipDataMap");
    if (clipMap?.type !== "Map")
      throw Error(`Missing clip map for ${rootPath}`);
    const clips = new Map();
    for (const clip of clipMap.entries) {
      if (clip.key.type !== "Hash" || clips.has(hex(clip.key.value)))
        throw Error(`Ambiguous authored animation clip key for ${rootPath}`);
      clips.set(hex(clip.key.value), clip.value);
    }
    const probes = {};
    for (const name of nameProbes) {
      const clip = clips.get(mapBinHash(name));
      if (!clip) continue;
      const result = { classHash: clip.classHash };
      if (includeEvents) result.events = field(clip, "mEventDataMap")?.entries;
      if (clip.classHash === mapBinHash("AtomicClipData")) {
        const resource = field(
          field(clip, "mAnimationResourceData"),
          "mAnimationFilePath",
        );
        let asset;
        if (resource?.type === "String") asset = await read(resource.value);
        else if (resource?.type === "WadChunkLink")
          asset = await read.byHash(BigInt(resource.value));
        else
          throw Error(
            `Unsupported authored animation resource for ${rootPath} ${name}`,
          );
        const { magic, version } = archivedAnimationFormat(asset);
        Object.assign(result, {
          resource,
          bytes: asset.byteLength,
          sha256: hash(asset),
          magic,
          version,
        });
      }
      probes[name] = result;
    }
    actors.push({
      champion,
      skinId,
      context,
      ...(includeEvents
        ? { footerRow: actor.footerRow, creationSha256: actor.creationSha256 }
        : {}),
      skinSha256,
      animationGraph: {
        path,
        graphHash,
        sha256: hash(bytes),
        clips: clips.size,
      },
      probes,
    });
  }
  return {
    schema: 1,
    build: manifest.build,
    protocol: manifest.protocol,
    replaySha256,
    executableSha256,
    championManifestSha256: hash(manifestBytes),
    scope: "Authored graph and named-clip asset verification",
    playback: null,
    actors,
  };
}

if (import.meta.main) {
  const [installation, manifestPath, replayPath, ...extra] =
    process.argv.slice(2);
  if (!installation || !manifestPath || !replayPath || extra.length)
    throw Error(
      "Usage: bun verify-native-terrain-champion-animation.mjs <exact Windows installation> <private champion manifest> <original ROFL>",
    );
  const names = ["Idle", "Idle1", "Idle1_Base", "Run", "Run1", "Run_Base"];
  console.log(
    JSON.stringify(
      await auditChampionAnimation(
        installation,
        manifestPath,
        await readFile(replayPath),
        names,
      ),
      null,
      2,
    ),
  );
}
