import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { parseArgs } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import { prepareReplayForSeek } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/prepare.mjs";
import { openReplay } from "../../transport.mjs";
import { terrainPositionProtocol } from "./native-terrain-byte-codecs.mjs";
import { bindNativeTerrainChampionIdentities } from "./native-terrain-champion-identities.mjs";
import {
  championArchiveExecutableHashes,
  currentChampionBuild,
  openChampionModelCatalog,
  readChampionModelSelections,
} from "./native-terrain-champion-model-catalog.mjs";
import { createExactTerrainByteCodecs } from "./native-terrain-positions-944.mjs";
import { verifyCanonicalRecordedRift } from "./verify-canonical-rift-replay.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const shaPattern = /^[a-f0-9]{64}$/u;
const championPattern = /^[a-z0-9_]+$/iu;
const skinKey = (champion, skinId) => `${champion.toLowerCase()}-${skinId}`;

export function selectCurrentArchivedOpeningSkins(census, opening) {
  assert.ok(
    census.schema === 1 &&
      census.kind === "exact-native-terrain-archived-skin-census" &&
      census.build === currentChampionBuild &&
      census.protocol === terrainPositionProtocol &&
      census.installedExeSha256 ===
        championArchiveExecutableHashes[currentChampionBuild] &&
      Array.isArray(census.archiveRoots),
    "Expected the exact current archived skin census",
  );
  const byChampion = new Map();
  for (const archive of census.archiveRoots) {
    assert.match(archive.champion, championPattern);
    const key = archive.champion.toLowerCase();
    assert.ok(!byChampion.has(key), "Duplicate archived champion root");
    assert.ok(
      Array.isArray(archive.skins),
      "Archived champion has no skin index",
    );
    byChampion.set(key, archive);
  }
  const selected = new Map();
  assert.equal(opening.length, 10, "Expected ten verified opening actors");
  assert.equal(
    new Set(opening.map(({ context }) => context)).size,
    opening.length,
    "Expected distinct verified opening actors",
  );
  for (const { champion, skinId } of opening) {
    assert.match(champion, championPattern);
    assert.ok(Number.isSafeInteger(skinId) && skinId >= 0 && skinId <= 10_000);
    const key = skinKey(champion, skinId);
    const archive = byChampion.get(champion.toLowerCase());
    assert.equal(
      archive?.skins.filter((row) => row.skinId === skinId).length,
      1,
      `Missing or ambiguous exact archived skin: ${key}`,
    );
    selected.set(key, { champion: archive.champion, skinId });
  }
  return {
    schema: 1,
    kind: "exact-native-terrain-skin-selection",
    build: currentChampionBuild,
    protocol: terrainPositionProtocol,
    skins: [...selected.keys()].sort().map((key) => selected.get(key)),
  };
}

async function inspectCatalog(
  path,
  pin,
  censusPin,
  replay,
  opening,
  selection,
) {
  if (path === undefined) return null;
  const { catalog, readModel } = await openChampionModelCatalog(
    path,
    pin,
    replay,
    opening,
  );
  assert.equal(
    catalog.selectionKind,
    "archive",
    "Held-out intake requires an archive-scoped champion catalog",
  );
  assert.equal(
    catalog.sourceCensusSha256,
    censusPin,
    "Champion catalog differs from the pinned source census",
  );
  const missing = selection.skins
    .map(({ champion, skinId }) => skinKey(champion, skinId))
    .filter((key) => !Object.hasOwn(catalog.assets, key));
  let verifiedBindings = 0;
  for (const actor of opening) {
    if (!Object.hasOwn(catalog.assets, skinKey(actor.champion, actor.skinId)))
      continue;
    await readModel(actor);
    verifiedBindings++;
  }
  return { verifiedBindings, missing, ready: missing.length === 0 };
}

async function writePrivateSelection(output, bytes) {
  const cache = await realpath(".cache");
  const parent = await realpath(dirname(output));
  if (parent !== cache && !parent.startsWith(cache + sep))
    throw Error(
      "Archive selection output must stay inside the private .cache directory",
    );
  await writeFile(join(parent, basename(output)), bytes, { flag: "wx" });
}

async function main(args) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      catalog: { type: "string" },
      "catalog-sha256": { type: "string" },
      "selection-output": { type: "string" },
    },
  });
  const [replayPath, matchPath, matchPin, decoderPath, censusPath, censusPin] =
    positionals;
  const catalogPath = values.catalog;
  const catalogPin = values["catalog-sha256"];
  if (
    positionals.length !== 6 ||
    !shaPattern.test(matchPin) ||
    !shaPattern.test(censusPin) ||
    (catalogPath === undefined) !== (catalogPin === undefined) ||
    (catalogPin !== undefined && !shaPattern.test(catalogPin))
  )
    throw Error(
      "Usage: bun inspect-current-rift-admission.mjs <ROFL> <canonical Match-V5 JSON> <SHA-256> <decoder> <archived skin census> <SHA-256> [--catalog <manifest> --catalog-sha256 <SHA-256>] [--selection-output <new private .cache JSON>]",
    );
  const replayBytes = await Bun.file(replayPath).arrayBuffer();
  const replay = openReplay(replayBytes);
  await verifyCanonicalRecordedRift(matchPath, matchPin, replayPath, replay);
  const censusBytes = await readFile(censusPath);
  assert.equal(
    sha(censusBytes),
    censusPin,
    "Archived skin census digest differs",
  );
  const options = { allowCurrentBuild: true };
  const prepared = prepareReplayForSeek(
    replayBytes,
    (input, target) =>
      zstdDecompressSync(input, { maxOutputLength: target.byteLength }),
    options,
  );
  const codecs = createExactTerrainByteCodecs(
    await readFile(decoderPath),
    replay,
    options,
  );
  const { binding } = bindNativeTerrainChampionIdentities(
    prepared,
    codecs,
    options,
  );
  const opening = readChampionModelSelections(
    {
      ...prepared,
      observations: { ...prepared.observations, binding },
    },
    codecs,
    options,
  );
  const selection = selectCurrentArchivedOpeningSkins(
    JSON.parse(censusBytes.toString("utf8")),
    opening,
  );
  const coverage = await inspectCatalog(
    catalogPath,
    catalogPin,
    censusPin,
    replay,
    opening,
    selection,
  );
  const output = values["selection-output"];
  const bytes = Buffer.from(`${JSON.stringify(selection, null, 2)}\n`);
  if (output !== undefined) await writePrivateSelection(output, bytes);
  console.log(
    JSON.stringify(
      {
        build: replay.build,
        protocol: replay.protocol,
        verifiedOpeningActors: opening.length,
        requiredSkins: selection.skins,
        selectionSha256: sha(bytes),
        catalogCoverage: coverage,
      },
      null,
      2,
    ),
  );
  if (coverage?.ready === false) process.exitCode = 2;
}

if (import.meta.main) await main(process.argv.slice(2));
