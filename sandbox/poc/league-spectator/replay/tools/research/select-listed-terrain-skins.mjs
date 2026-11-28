import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import { championArchiveExecutableHashes } from "./native-terrain-champion-model-catalog.mjs";

const digestPattern = /^[a-f0-9]{64}$/;
const championPattern = /^[a-z0-9_]+$/i;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function indexArchive(census) {
  assert.equal(census.schema, 1);
  assert.equal(census.kind, "exact-native-terrain-archived-skin-census");
  assert.equal(census.build, currentTerrainPositionBuild);
  assert.equal(census.protocol, terrainPositionProtocol);
  assert.equal(
    census.installedExeSha256,
    championArchiveExecutableHashes[currentTerrainPositionBuild],
  );
  const champions = new Map();
  for (const { champion, skins } of census.archiveRoots) {
    assert.match(champion, championPattern);
    const key = champion.toLowerCase();
    assert.ok(!champions.has(key), `Duplicate champion archive: ${key}`);
    const ids = new Set();
    for (const { skinId } of skins) {
      assert.ok(Number.isInteger(skinId) && skinId >= 0 && skinId <= 10000);
      assert.ok(!ids.has(skinId), `Duplicate archived skin: ${key}-${skinId}`);
      ids.add(skinId);
    }
    champions.set(key, { champion, ids });
  }
  return champions;
}

export function selectListedTerrainSkins(census, dataDragon, baseOnly) {
  const champions = indexArchive(census);
  const { type, format, version, data } = dataDragon;
  assert.equal(type, "champion");
  assert.equal(format, "full");
  assert.match(version, /^\d+\.\d+\.[1-9]\d*$/);
  const patch = (build) => build.split(".").slice(0, 2).join(".");
  assert.equal(
    patch(version),
    patch(census.build),
    "Data Dragon patch differs",
  );
  assert.ok(data && !Array.isArray(data) && typeof data === "object");
  const listed = Object.entries(data).sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  );
  assert.ok(listed.length > 0);
  const seen = new Set();
  const skins = [];
  for (const [key, { id, skins: listedSkins }] of listed) {
    assert.equal(key, id);
    assert.match(id, championPattern);
    const normalized = id.toLowerCase();
    assert.ok(!seen.has(normalized), `Duplicate listed champion: ${id}`);
    seen.add(normalized);
    const archive = champions.get(normalized);
    assert.ok(archive, `Listed champion missing from archive: ${id}`);
    const ids = new Set();
    for (const { num } of listedSkins) {
      assert.ok(!ids.has(num), `Duplicate listed skin: ${id}-${num}`);
      assert.ok(
        archive.ids.has(num),
        `Listed skin missing from archive: ${id}-${num}`,
      );
      ids.add(num);
    }
    assert.ok(ids.has(0), `Listed champion has no default skin: ${id}`);
    for (const skinId of [...ids].sort((a, b) => a - b)) {
      if (baseOnly && skinId !== 0) continue;
      skins.push({ champion: archive.champion, skinId });
    }
  }
  return {
    schema: 1,
    kind: "exact-native-terrain-skin-selection",
    build: census.build,
    protocol: census.protocol,
    skins,
  };
}

async function readPinnedJson(file, digest) {
  assert.match(digest, digestPattern);
  const bytes = await Bun.file(file).bytes();
  assert.equal(sha256(bytes), digest, `Input SHA-256 differs: ${file}`);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { "base-only": { type: "boolean", default: false } },
  });
  const [censusPath, censusSha256, dataPath, dataSha256] = positionals;
  assert.equal(
    positionals.length,
    4,
    "Usage: bun select-listed-terrain-skins.mjs <archive census> <census SHA-256> <Data Dragon championFull.json> <Data Dragon SHA-256> [--base-only]",
  );
  const [census, data] = await Promise.all([
    readPinnedJson(censusPath, censusSha256),
    readPinnedJson(dataPath, dataSha256),
  ]);
  const selection = selectListedTerrainSkins(census, data, values["base-only"]);
  console.log(
    JSON.stringify(
      {
        ...selection,
        sourceCensusSha256: censusSha256,
        dataDragon: { version: data.version, sha256: dataSha256 },
      },
      null,
      2,
    ),
  );
}
