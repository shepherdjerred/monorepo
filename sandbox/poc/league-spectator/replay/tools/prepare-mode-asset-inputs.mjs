// Static authored mode libraries from the installed build; no replay decoding.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openLocalWad } from "./wad.mjs";

if (process.argv.length !== 5)
  throw Error(
    "Usage: prepare-mode-asset-inputs.mjs <cache> <installation> <mode>",
  );
const cache = resolve(process.argv[2]),
  installation = resolve(process.argv[3]),
  mode = process.argv[4],
  root = resolve(import.meta.dir, ".."),
  output = `${cache}/research/mode-asset-inputs-${mode.toLowerCase()}`,
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (!/^[a-zA-Z0-9_]{1,32}$/.test(mode)) throw Error("Invalid static mode name");
const profile = await Bun.file(
    `${cache}/public/decoder-16.21-macos/profile.json`,
  ).json(),
  executable = await Bun.file(
    `${installation}/Game/League of Legends.exe`,
  ).bytes(),
  mapBytes = await Bun.file(
    `${cache}/public/latest-map-effect-inputs/package.json`,
  ).bytes(),
  map = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(mapBytes));
if (
  profile.clientVersion !== "16.21.829.8620" ||
  profile.protocolDigest !== "20e09df23c66b85e" ||
  sha(executable) !== profile.windowsClientSha256 ||
  map.build !== profile.clientVersion ||
  map.protocol !== profile.protocolDigest
)
  throw Error("Exact installed static mode asset build required");
const parsedMap = map.parser.results.find((r) => r.path === map.source.path);
if (!parsedMap || parsedMap.sourceSha256 !== map.source.sha256)
  throw Error("Static mode source differs from the prepared map parser input");
const parsedBytes = await Bun.file(
  `${cache}/research/map-effect-inputs/${map.source.sha256}.json`,
).bytes();
if (
  sha(parsedBytes) !== parsedMap.jsonSha256 ||
  sha(
    await Bun.file(
      `${cache}/public/latest-map-effect-inputs/${map.source.file}`,
    ).bytes(),
  ) !== map.source.sha256
)
  throw Error("Prepared static mode map bytes changed");
let modeHash = 2166136261;
for (const byte of new TextEncoder().encode(mode.toLowerCase()))
  modeHash = Math.imul(modeHash ^ byte, 16777619) >>> 0;
const modeKey = `{${modeHash.toString(16).padStart(8, "0")}}`,
  records = Object.entries(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(parsedBytes)),
  ).filter(
    ([, v]) => v?.__type === "GameModeMapData" && v.mModeName === modeKey,
  );
if (records.length !== 1)
  throw Error("Static mode does not select one authored map record");
const [identity, definition] = records[0],
  paths = [
    ...new Set(["items", ...(definition.AdditionalPropertyDataPaths ?? [])]),
  ];
if (paths.some((p) => typeof p !== "string" || !p || p.length > 512))
  throw Error("Invalid authored static mode library path");
const { decompress } = await import(
    pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
  ),
  archives = [
    "DATA/FINAL/DATA.wad.client",
    "DATA/FINAL/Global.wad.client",
    "DATA/FINAL/Maps/Shipping/Common.wad.client",
    "DATA/FINAL/Maps/Shipping/Map12.wad.client",
  ],
  readers = await Promise.all(
    archives.map(async (archive) => ({
      archive,
      read: await openLocalWad(installation, archive, decompress),
    })),
  ),
  jobs = [],
  absent = [];
for (const path of paths) {
  const matches = readers.filter((r) => r.read.has(path));
  if (!matches.length) {
    absent.push(path);
    continue;
  }
  const variants = await Promise.all(matches.map((r) => r.read(path))),
    digest = sha(variants[0]);
  if (variants.some((bytes) => sha(bytes) !== digest))
    throw Error(`Conflicting installed static mode library: ${path}`);
  const source = `${output}/${digest}.bin`,
    parsed = `${output}/${digest}.json`;
  await Bun.write(source, variants[0]);
  jobs.push({
    path,
    source,
    output: parsed,
    sha256: digest,
    archives: matches.map((r) => r.archive),
  });
}
if (!jobs.length)
  throw Error(
    "No authored static mode libraries found in the selected archives",
  );
await Bun.write(
  `${output}/jobs.json`,
  JSON.stringify({ schema: 1, build: profile.clientVersion, jobs }, null, 2),
);
const child = Bun.spawn(
    [
      `${cache}/research/venv/Scripts/python.exe`,
      `${root}/tools/parse-latest-assets.py`,
      `${output}/jobs.json`,
      `${cache}/vfx`,
      `${output}/parsed.json`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  ),
  [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
if (code) throw Error(`Static mode parser failed: ${stdout}\n${stderr}`);
const index = {};
for (const job of jobs) {
  const bytes = await Bun.file(job.output).bytes();
  job.jsonSha256 = sha(bytes);
  const parsed = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  for (const [key, value] of Object.entries(parsed))
    if (/^\{[a-f0-9]{8}\}$/.test(key)) {
      const hash = key.slice(1, -1);
      if (!Object.hasOwn(index, hash)) index[hash] = [];
      index[hash].push({
        path: job.path,
        sourceSha256: job.sha256,
        type: value.__type,
      });
    }
}
const result = {
  schema: 1,
  kind: "installed-static-mode-asset-inputs",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  executableSha256: sha(executable),
  mode,
  modeHash,
  modeIdentity: identity,
  mapPackageSha256: sha(mapBytes),
  jobs,
  absent,
  index,
  parser: await Bun.file(`${output}/parsed.json`).json(),
  sources: Object.fromEntries(
    await Promise.all(
      [
        "tools/prepare-mode-asset-inputs.mjs",
        "tools/parse-latest-assets.py",
        "tools/wad.mjs",
      ].map(async (path) => [
        path,
        sha(await Bun.file(`${root}/${path}`).bytes()),
      ]),
    ),
  ),
  scope: {
    staticBuildDataOnly: true,
    containsReplayEvents: false,
    typedReferencesFixed: false,
    assetReadinessVerified: false,
    mainViewerExpanded: false,
  },
};
await Bun.write(`${output}/index.json`, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: `${output}/index.json`,
    mode,
    modeIdentity: identity,
    sources: jobs.map((job) => job.path),
    roots: Object.keys(index).length,
    absent,
  }),
);
