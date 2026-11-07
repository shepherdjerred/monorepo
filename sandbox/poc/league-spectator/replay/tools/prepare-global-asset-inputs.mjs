// Static shared/global BIN inputs from the exact installed client. No replay.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openLocalWad } from "./wad.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  installation = resolve(process.argv[3] ?? "C:/Riot Games/League of Legends"),
  root = resolve(import.meta.dir, ".."),
  output = `${cache}/research/global-asset-inputs`,
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  exe = await Bun.file(`${installation}/Game/League of Legends.exe`).bytes(),
  profile = await Bun.file(
    `${cache}/public/decoder-16.21-macos/profile.json`,
  ).json();
if (
  sha(exe) !==
    "6f8712cf8ff062d1a914796fe0ad057dae86064d4b651e0ff91d0f3885749d1a" ||
  profile.clientVersion !== "16.21.829.8620" ||
  profile.protocolDigest !== "20e09df23c66b85e"
)
  throw Error("Exact matching installed global asset build required");
const { decompress } = await import(
    pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
  ),
  archives = [
    "DATA/FINAL/Global.wad.client",
    "DATA/FINAL/DATA.wad.client",
    "DATA/FINAL/Scripts.wad.client",
    "DATA/FINAL/Maps/Shipping/Common.wad.client",
    "DATA/FINAL/Maps/Shipping/Map12.wad.client",
    "DATA/FINAL/Maps/Shipping/Map30.wad.client",
    "DATA/FINAL/Bootstrap.windows.wad.client",
    "DATA/FINAL/UI.wad.client",
  ],
  readers = [];
for (const archive of archives)
  readers.push({
    archive,
    read: await openLocalWad(installation, archive, decompress),
  });
const paths = [
    "shared",
    "emblems",
    "perks",
    "globals",
    "data/shaders/shaders.bin",
    "assets/shaders/shareddata.bin",
    "data/shared/shared.bin",
    "data/emblems.bin",
    "global/perks/perks.bin",
    "data/maps/shipping/map30/map30.bin",
    "data/globals/globals.bin",
  ],
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
    throw Error(`Conflicting installed global asset variants: ${path}`);
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
if (!jobs.some((job) => job.path === "shared"))
  throw Error("Matching shared BIN input not found in searched archives");
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
if (code) throw Error(`Global asset parser failed: ${stdout}\n${stderr}`);
const index = {},
  wanted = new Set([
    "36adfd9d",
    "778bc894",
    "a1cb11a6",
    "48bcf9ca",
    "763fb416",
  ]);
for (const job of jobs) {
  const bytes = await Bun.file(job.output).bytes(),
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  job.jsonSha256 = sha(bytes);
  for (const [key, value] of Object.entries(parsed))
    if (/^\{[a-f0-9]{8}\}$/.test(key)) {
      const identity = key.slice(1, -1);
      if (!Object.hasOwn(index, identity)) index[identity] = [];
      index[identity].push({
        path: job.path,
        sourceSha256: job.sha256,
        type: value.__type,
      });
    }
}
const result = {
  schema: 1,
  kind: "installed-static-global-asset-inputs",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  executableSha256: sha(exe),
  jobs,
  absent,
  index,
  parser: await Bun.file(`${output}/parsed.json`).json(),
  sources: Object.fromEntries(
    await Promise.all(
      [
        "tools/prepare-global-asset-inputs.mjs",
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
    sources: jobs.map((job) => job.path),
    roots: Object.keys(index).length,
    absent,
    wanted: Object.fromEntries(
      [...wanted].map((identity) => [identity, index[identity] ?? []]),
    ),
  }),
);
