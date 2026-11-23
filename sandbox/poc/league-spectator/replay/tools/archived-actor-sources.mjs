import { pathToFileURL } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { openWad } from "./wad.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { createActorNativeMapNormalizer } from "./archived-actor-native-maps.mjs";
import {
  readActorMetaNames,
  normalizeActorBin,
  actorUnsupportedDeclarations,
  ACTOR_META_SOURCE_SHA256,
  ACTOR_TOOLKIT_REVISION,
} from "./archived-actor-bin.mjs";
import {
  MAP11_RELEASE_SHA256,
  MAP11_RESEARCH_BUILD,
} from "./map-scene-assets.mjs";

export const actorSha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
// A WAD namespace is hashed for archive lookup; it never becomes a host path.
// Original Multi_Skins dependency names exceed 1,024 characters.
export const isOriginalActorNamespacePath = (value) =>
  typeof value === "string" &&
  value.length <= 4096 &&
  /^[\w./-]+$/.test(value) &&
  !value.startsWith("/") &&
  value.split("/").every((part) => part && part !== "." && part !== "..");
const safePath = isOriginalActorNamespacePath;

export async function openArchivedActorSources({
  parserCheckout,
  sourceCache,
  archiveCache,
  nativeMapObservations = [],
}) {
  const releaseBytes = await Bun.file(
    path.join(archiveCache, "release.manifest"),
  ).bytes();
  if (actorSha256(releaseBytes) !== MAP11_RELEASE_SHA256)
    throw Error("Pinned archived 16.21 release manifest required");
  const parserFile = path.join(parserCheckout, "src/rman.js");
  const parserBytes = await Bun.file(parserFile).bytes();
  const { parseRman } = await import(pathToFileURL(parserFile).href);
  const metadataPath = path.join(
    sourceCache,
    "research/LeagueToolkit/src/LeagueToolkit.Meta.Classes/Classes.cs",
  );
  const metadataBytes = await Bun.file(metadataPath).bytes();
  if (actorSha256(metadataBytes) !== ACTOR_META_SOURCE_SHA256)
    throw Error("Pinned Toolkit metadata names changed");
  const names = readActorMetaNames(
    new TextDecoder("utf-8", { fatal: true }).decode(metadataBytes),
  );
  const wads = new Map(),
    provenance = [],
    binaries = new Map();
  async function wad(name) {
    if (!safePath(name)) throw Error("Invalid archived WAD path");
    const key = name.toLowerCase();
    if (!wads.has(key)) {
      const release = parseRman(releaseBytes, { targetFile: name });
      if (release.manifestId !== "B499FB04B1158CF6")
        throw Error("Archived actor release identity mismatch");
      release.sourceSha256 = MAP11_RELEASE_SHA256;
      wads.set(
        key,
        await openWad(release, name, archiveCache, (bytes) =>
          Bun.zstdDecompressSync(bytes),
        ),
      );
    }
    return wads.get(key);
  }
  async function read(wadName, reference) {
    const get = await wad(wadName);
    let bytes;
    if (typeof reference === "string") {
      if (!safePath(reference))
        throw Error("Invalid original actor asset path");
      bytes = await get(reference.toLowerCase());
    } else if (
      reference?.kind === "wad-path-hash" &&
      /^\d+$/.test(reference.value)
    ) {
      bytes = await get.byHash(BigInt(reference.value));
    } else throw Error("Original actor WAD reference required");
    provenance.push({
      wad: wadName,
      reference,
      bytes: bytes.length,
      sha256: actorSha256(bytes),
    });
    return bytes;
  }
  async function bin(wadName, file, knownPaths = []) {
    if (!safePath(file) || !file.toLowerCase().endsWith(".bin"))
      throw Error("Original actor BIN path required");
    const key = `${wadName.toLowerCase()}:${file.toLowerCase()}`;
    if (!binaries.has(key)) {
      const bytes = await read(wadName, file),
        tree = readExactMapBin(bytes, MAP11_RESEARCH_BUILD);
      binaries.set(key, { file, bytes, tree });
    }
    const captured = binaries.get(key);
    try {
      const nativeMapDeclarations = [];
      const normalized = normalizeActorBin(
        captured.tree,
        names,
        knownPaths,
        createActorNativeMapNormalizer(
          nativeMapObservations,
          nativeMapDeclarations,
        ),
      );
      return {
        ...captured,
        normalized,
        nativeMapDeclarations,
        unsupportedDeclarations: actorUnsupportedDeclarations(normalized),
      };
    } catch (error) {
      if (error.binMap) {
        const directory = path.join(
          archiveCache,
          "research/archived-actor-errors",
        );
        await mkdir(directory, { recursive: true });
        const evidence = path.join(
          directory,
          `${captured.tree.sourceSha256}.json`,
        );
        await Bun.write(
          evidence,
          JSON.stringify(
            {
              wad: wadName,
              file,
              sourceSha256: captured.tree.sourceSha256,
              field: error.binField,
              map: error.binMap,
            },
            null,
            2,
          ),
        );
        throw Error(
          `Duplicate original BIN map key; exact field/key evidence: ${evidence}`,
          { cause: error },
        );
      }
      throw error;
    }
  }
  return {
    wad,
    read,
    bin,
    provenance: () => [
      ...new Map(
        provenance.map((entry) => [JSON.stringify(entry), entry]),
      ).values(),
    ],
    receipts: () => [
      ...new Map(
        [...wads.values()]
          .flatMap((get) => get.rmanReceipts())
          .map((entry) => [entry.chunkId, entry]),
      ).values(),
    ],
    toolchain: {
      leagueToolkitRevision: ACTOR_TOOLKIT_REVISION,
      metadataNamesSha256: ACTOR_META_SOURCE_SHA256,
      rmanParserSha256: actorSha256(parserBytes),
    },
  };
}
