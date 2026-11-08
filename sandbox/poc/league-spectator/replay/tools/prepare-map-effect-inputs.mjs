// Static map resources from the exact installed build. No replay is read.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openLocalWad } from "./wad.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  installation = resolve(process.argv[3] ?? "C:/Riot Games/League of Legends"),
  root = resolve(import.meta.dir, ".."),
  work = `${cache}/research/map-effect-inputs`,
  output = `${cache}/public/latest-map-effect-inputs`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = (p) => Bun.file(p).bytes(),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  profile = await Bun.file(
    `${cache}/public/decoder-16.21-macos/profile.json`,
  ).json(),
  exe = await raw(`${installation}/Game/League of Legends.exe`);
if (
  profile.clientVersion !== "16.21.829.8620" ||
  profile.protocolDigest !== "20e09df23c66b85e" ||
  sha(exe) !==
    "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a" ||
  sha(image) !== profile.decoderImageSha256
)
  throw Error("Exact installed map resource build/image required");
const { decompress } = await import(
    pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
  ),
  archive = "DATA/FINAL/Maps/Shipping/Map12.wad.client",
  path = "data/maps/shipping/map12/map12.bin",
  read = await openLocalWad(installation, archive, decompress),
  bytes = await read(path),
  digest = sha(bytes),
  source = `${work}/${digest}.bin`,
  parsed = `${work}/${digest}.json`;
await Bun.write(source, bytes);
await Bun.write(
  `${work}/jobs.json`,
  JSON.stringify(
    {
      schema: 1,
      build: profile.clientVersion,
      jobs: [{ path, source, output: parsed, sha256: digest }],
    },
    null,
    2,
  ),
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
  ),
  [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
if (code) throw Error(`Map effect parser failed: ${stdout}\n${stderr}`);
const provenance = await Bun.file(`${work}/parsed.json`).json(),
  parsedBytes = await raw(parsed),
  data = JSON.parse(new TextDecoder().decode(parsedBytes)),
  id = (v) => {
    if (typeof v !== "string" || !/^\{[a-f0-9]{8}\}$/.test(v))
      throw Error("Original map asset hash required");
    return v.slice(1, -1);
  },
  resolvers = {},
  mapSkins = {},
  guests = {},
  definitions = {};
if (
  provenance.results.length !== 1 ||
  provenance.results[0].sourceSha256 !== digest ||
  provenance.results[0].jsonSha256 !== sha(parsedBytes) ||
  provenance.results[0].dependencies.length
)
  throw Error("Map parser/source/closure identity differs");
for (const [key, entry] of Object.entries(data)) {
  if (key.startsWith("__")) continue;
  const keyId = id(key);
  if (entry.__type === "ResourceResolver")
    resolvers[keyId] = {
      rows: Object.entries(entry.resourceMap ?? {})
        .map(([key, value]) => ({
          key: parseInt(id(key), 16),
          reference: id(value),
        }))
        .sort((a, b) => a.key - b.key),
    };
  else if (entry.__type === "MapSkin")
    mapSkins[keyId] = {
      name: entry.name,
      resolvers: (entry.mResourceResolvers ?? []).map(id),
    };
  else if (entry.__type === "GuestOfHonor")
    guests[keyId] = {
      name: entry.name,
      resourceResolver: id(entry.ResourceResolver),
      scriptKey: entry["{fb33ef71}"],
    };
  else if (entry.__type === "VfxSystemDefinitionData")
    definitions[keyId] = entry;
}
for (const skin of Object.values(mapSkins))
  for (const resolver of skin.resolvers)
    if (!resolvers[resolver])
      throw Error("Map skin references an absent authored resolver");
for (const guest of Object.values(guests))
  if (!resolvers[guest.resourceResolver])
    throw Error("Guest references an absent authored resolver");
await Bun.write(`${output}/map.bin`, bytes);
await Bun.write(`${output}/definitions.json`, JSON.stringify(definitions));
const result = {
  schema: 1,
  kind: "installed-map-effect-inputs",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  decoderImageSha256: sha(image),
  mapId: 12,
  source: {
    path,
    archive,
    file: "map.bin",
    sha256: digest,
    bytes: bytes.length,
  },
  definitions: {
    file: "definitions.json",
    sha256: sha(await raw(`${output}/definitions.json`)),
    count: Object.keys(definitions).length,
  },
  definitionIndex: Object.fromEntries(
    Object.entries(definitions).map(([id, value]) => [
      id,
      {
        name: value.particleName ?? null,
        sha256: sha(JSON.stringify(value)),
        complexEmitters: (value.complexEmitterDefinitionData ?? []).length,
        simpleEmitters: (value.simpleEmitterDefinitionData ?? []).length,
      },
    ]),
  ),
  resolvers,
  mapSkins,
  guests,
  parser: provenance,
  sources: Object.fromEntries(
    await Promise.all(
      [
        "tools/prepare-map-effect-inputs.mjs",
        "tools/parse-latest-assets.py",
        "tools/wad.mjs",
      ].map(async (name) => [name, sha(await raw(`${root}/${name}`))]),
    ),
  ),
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    mapVariantSelected: false,
    guestSelected: false,
    resolverValuesAreReferenceTokens: true,
    externalLinksResolved: false,
    nativeReaderCompared: false,
    renderingIntegrated: false,
  },
};
await Bun.write(`${output}/package.json`, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    sha256: sha(await raw(`${output}/package.json`)),
    resolvers: Object.keys(resolvers).length,
    rows: Object.values(resolvers).reduce((n, r) => n + r.rows.length, 0),
    mapSkins: Object.keys(mapSkins).length,
    guests: Object.keys(guests).length,
    definitions: Object.keys(definitions).length,
  }),
);
