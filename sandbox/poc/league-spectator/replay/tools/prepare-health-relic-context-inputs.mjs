// Standalone installed static inputs; no replay events or registry state.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openLocalWad } from "./wad.mjs";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  installation = resolve(process.argv[3] ?? "C:/Riot Games/League of Legends"),
  root = resolve(import.meta.dir, "..");
const inputs = {};
const raw = async (path) => {
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
};
const profile = JSON.parse(
  new TextDecoder().decode(
    await raw(`${cache}/public/decoder-16.21-macos/profile.json`),
  ),
);
if (
  profile.clientVersion !== "16.21.829.8620" ||
  profile.protocolDigest !== "20e09df23c66b85e" ||
  (await sha256(await raw(`${installation}/Game/League of Legends.exe`))) !==
    "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a"
)
  throw Error("Exact installed build required");
await raw(import.meta.path);
await raw(`${root}/tools/wad.mjs`);
await raw(`${root}/tools/parse-latest-assets.py`);
const { decompress } = await import(
  pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
);
await raw(`${cache}/public/vendor/fzstd.mjs`);
const archive = "DATA/FINAL/Maps/Shipping/Map12.wad.client",
  get = await openLocalWad(installation, archive, decompress),
  work = `${cache}/research/health-relic-context-inputs`,
  jobs = [];
for (const path of [
  "data/characters/ha_ap_healthrelic/ha_ap_healthrelic.bin",
  "data/characters/ha_ap_healthrelic/skins/skin0.bin",
]) {
  const bytes = await get(path),
    hash = await sha256(bytes),
    source = `${work}/${hash}.bin`,
    output = `${work}/${hash}.json`;
  await Bun.write(source, bytes);
  inputs[source] = hash;
  jobs.push({ path, source, output, sha256: hash });
}
await Bun.write(
  `${work}/jobs.json`,
  JSON.stringify({ schema: 1, build: profile.clientVersion, jobs }, null, 2),
);
const child = Bun.spawn(
  [
    `${cache}/research/venv/Scripts/python.exe`,
    `${root}/tools/parse-latest-assets.py`,
    `${work}/jobs.json`,
    `${cache}/vfx`,
    `${work}/parsed.json`,
  ],
  { stdout: "pipe", stderr: "pipe" },
);
const [stdout, stderr, code] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
if (code) throw Error(`Pinned static parser failed: ${stdout}\n${stderr}`);
for (const file of ["jobs.json", "parsed.json"]) await raw(`${work}/${file}`);
for (const job of jobs) await raw(job.output);
for (const name of ["binfields", "bintypes"])
  await raw(`${cache}/vfx/hashes.${name}.txt`);
const parsed = await Promise.all(
  jobs.map(async (job) =>
    JSON.parse(new TextDecoder().decode(await raw(job.output))),
  ),
);
const records = Object.values(parsed[0]).filter(
    (row) => row.__type === "CharacterRecord",
  ),
  skins = Object.values(parsed[1]).filter(
    (row) => row.__type === "SkinCharacterDataProperties",
  );
if (
  records.length !== 1 ||
  records[0].mCharacterName !== "HA_AP_HealthRelic" ||
  skins.length !== 1 ||
  !/^\{[a-f0-9]{8}\}$/.test(skins[0].mResourceResolver)
)
  throw Error("Exact HealthRelic character/skin resources required");
const resolver = parsed[1][skins[0].mResourceResolver];
if (resolver?.__type !== "ResourceResolver" || !resolver.resourceMap)
  throw Error("Authored HealthRelic resolver required");
const resourceKeys = Object.keys(resolver.resourceMap)
  .map((key) => {
    if (!/^\{[a-f0-9]{8}\}$/.test(key))
      throw Error("Exact authored resource key required");
    return Number.parseInt(key.slice(1, -1), 16);
  })
  .sort((a, b) => a - b);
const requestedKeys = [0x28b32fa1, 0xbcdfd120];
if (requestedKeys.some((key) => resourceKeys.includes(key)))
  throw Error(
    "Requested map-global key unexpectedly belongs to HealthRelic skin",
  );
const mapPackage = JSON.parse(
    new TextDecoder().decode(
      await raw(`${cache}/public/latest-map-effect-inputs/package.json`),
    ),
  ),
  mapParse = JSON.parse(
    new TextDecoder().decode(
      await raw(`${cache}/research/map-effect-inputs/parsed.json`),
    ),
  );
const mapBytes = await raw(
    `${cache}/research/map-effect-inputs/${mapPackage.source.sha256}.json`,
  ),
  mapEntry = mapParse.results.find(
    (row) => row.sourceSha256 === mapPackage.source.sha256,
  );
if (
  mapPackage.build !== profile.clientVersion ||
  mapPackage.protocol !== profile.protocolDigest ||
  !mapEntry ||
  mapEntry.jsonSha256 !== (await sha256(mapBytes))
)
  throw Error("Pinned parsed Map12 inputs required");
const map = JSON.parse(new TextDecoder().decode(mapBytes));
const mapRoots = Object.entries(map).filter(
  ([, row]) => row.__type === "Map" && row.mapStringId === "HA",
);
if (mapRoots.length !== 1) throw Error("Unique authored HA map root required");
const preloadLinks = [];
for (const listId of mapRoots[0][1].characterLists ?? []) {
  const list = map[listId];
  if (list?.__type !== "MapCharacterList")
    throw Error("Authored map character list required");
  for (const characterId of list.characters ?? [])
    if (map[characterId]?.name === records[0].mCharacterName)
      preloadLinks.push({
        mapId: mapRoots[0][0],
        listId,
        characterId,
        character: structuredClone(map[characterId]),
      });
}
if (!preloadLinks.length)
  throw Error("HealthRelic is not in authored map character lists");
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Input changed: ${path}`);
const output = `${work}/manifest.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "installed-health-relic-context-inputs",
      build: profile.clientVersion,
      protocol: profile.protocolDigest,
      archive,
      jobs,
      characterName: records[0].mCharacterName,
      resourceResolverId: skins[0].mResourceResolver,
      authoredResourceKeys: resourceKeys,
      absentRequestedKeys: requestedKeys,
      mapCharacterPreloadLinks: preloadLinks,
      inputs,
      scope: {
        staticInputsOnly: true,
        replayRegistryRecovered: false,
        resourceGetterExecuted: false,
        runtimePlaybackInput: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output, parsed: jobs.length }));
