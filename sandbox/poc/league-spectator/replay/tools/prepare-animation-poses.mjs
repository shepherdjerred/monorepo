import { resolve, dirname, join } from "node:path";
import { mkdir, cp } from "node:fs/promises";
import { readAnimationAsset } from "../latest-animation.mjs";
import { compileAnimationPoseTimeDomain } from "../latest-animation-pose-time-domain.mjs";

const [packagePath, scenePath, toolkitPath, workPath, outputPath, dotnetPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun prepare-animation-poses.mjs <decoder> <scene> <LeagueToolkit> <work> <output> [dotnet]",
  );
const root = resolve(packagePath),
  scene = resolve(scenePath),
  toolkit = resolve(toolkitPath),
  work = resolve(workPath),
  out = resolve(outputPath),
  hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = await Bun.file(`${root}/animation-clock.json`).arrayBuffer(),
  clock = JSON.parse(new TextDecoder().decode(raw)),
  profile = await Bun.file(`${root}/profile.json`).json(),
  sourceRoot = resolve(import.meta.dir, "animation-exporter"),
  dotnet = dotnetPath
    ? resolve(dotnetPath)
    : "C:/Program Files/dotnet/dotnet.exe";
if (
  hash(raw) !== profile.animationClockSha256 ||
  clock.build !== profile.clientVersion ||
  clock.protocol !== profile.protocolDigest ||
  hash(await Bun.file(`${scene}/manifest.json`).arrayBuffer()) !==
    clock.sceneManifestSha256
)
  throw Error("Animation pose inputs differ from clock package");
await mkdir(work, { recursive: true });
await mkdir(out, { recursive: true });
const sources = {};
for (const name of ["Program.cs", "AnimationExporter.csproj"]) {
  sources[`animation-exporter/${name}`] = hash(
    await Bun.file(`${sourceRoot}/${name}`).arrayBuffer(),
  );
  await cp(`${sourceRoot}/${name}`, `${work}/${name}`);
}
async function run(args) {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" }),
    [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
  if (code)
    throw Error(`Animation exporter failed (${code}): ${stdout}\n${stderr}`);
  return stdout;
}
const revision = (
  await run(["git", "-C", toolkit, "rev-parse", "HEAD"])
).trim();
if (revision !== "76bf57bf4fd195343dec610bf0f912a06b910914")
  throw Error(`Unprepared LeagueToolkit revision ${revision}`);
if ((await run(["git", "-C", toolkit, "status", "--porcelain"])).trim())
  throw Error("LeagueToolkit source has unrecorded modifications");
const sdkVersion = (await run([dotnet, "--version"])).trim();
if (sdkVersion !== "10.0.303")
  throw Error(`Unprepared pose compiler SDK ${sdkVersion}`);
await run([
  dotnet,
  "build",
  `${work}/AnimationExporter.csproj`,
  `-p:LeagueToolkitRoot=${toolkit}`,
  "--nologo",
  "-v:q",
]);
const assembly = `${work}/bin/Debug/net10.0/AnimationExporter.dll`,
  jobs = [],
  graphs = {};
for (const [graphFile, source] of Object.entries(clock.graphs)) {
  const catalogBytes = await Bun.file(
      `${scene}/${source.catalogFile}`,
    ).arrayBuffer(),
    catalog = JSON.parse(new TextDecoder().decode(catalogBytes)),
    directory = dirname(graphFile),
    unique = new Map(),
    clips = {};
  if (hash(catalogBytes) !== source.catalogSha256)
    throw Error("Pose source catalog changed");
  const rigFile = join(directory, "model.skl").replaceAll("\\", "/"),
    rigSha256 = hash(await Bun.file(`${scene}/${rigFile}`).arrayBuffer());
  for (const [name, clip] of Object.entries(source.clips)) {
    if (clip.status !== "prepared")
      throw Error("Unprepared native clock pose source");
    if (
      hash(await Bun.file(`${scene}/${clip.source.file}`).arrayBuffer()) !==
      clip.source.sha256
    )
      throw Error("Raw animation pose source changed");
    const key = `${clip.source.sha256}:${clip.clock.resourceFrames}`;
    let entry = unique.get(key);
    if (!entry) {
      const file = `clips/${unique.size}.clip`;
      entry = {
        file,
        frames: clip.clock.resourceFrames,
        sourceSha256: clip.source.sha256,
      };
      unique.set(key, entry);
      jobs.push({
        Rig: `${scene}/${rigFile}`,
        Source: `${scene}/${clip.source.file}`,
        Frames: clip.clock.resourceFrames,
        Output: `${out}/${directory}/${file}`,
      });
    }
    clips[name] = entry;
  }
  graphs[graphFile] = {
    actor: source.actor,
    directory: directory.replaceAll("\\", "/"),
    rigFile,
    rigSha256,
    graphSha256: source.graphSha256,
    sourceCatalogSha256: source.catalogSha256,
    catalog: { schema: 1, joints: catalog.joints, clips },
  };
}
await Bun.write(`${work}/jobs.json`, JSON.stringify(jobs));
const message = await run([dotnet, assembly, `${work}/jobs.json`]);
let bytes = 0,
  tracks = 0;
for (const source of Object.values(graphs)) {
  const seen = new Set();
  for (const entry of Object.values(source.catalog.clips)) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    const raw = await Bun.file(
        `${out}/${source.directory}/${entry.file}`,
      ).arrayBuffer(),
      asset = readAnimationAsset(raw);
    if (
      asset.frames !== entry.frames ||
      asset.tracks.some((t) => source.catalog.joints[t.jointId] !== t.bone)
    )
      throw Error("Pose frame/joint coverage differs from package");
    Object.assign(entry, {
      sha256: hash(raw),
      fps: asset.fps,
      duration: asset.duration,
    });
    bytes += raw.byteLength;
    tracks += asset.tracks.length;
  }
}
for (const [graphFile, source] of Object.entries(graphs))
  for (const [name, clip] of Object.entries(source.catalog.clips)) {
    const domain = compileAnimationPoseTimeDomain(
      clock.graphs[graphFile].clips[name],
      clip.fps,
    );
    if (domain !== null) clip.poseTimeDomain = domain;
  }
const result = {
  schema: 1,
  build: clock.build,
  protocol: clock.protocol,
  animationClockSha256: hash(raw),
  sceneManifestSha256: clock.sceneManifestSha256,
  toolchain: {
    sdkVersion,
    leagueToolkitRevision: revision,
    sources,
    assemblySha256: hash(await Bun.file(assembly).arrayBuffer()),
    preparerSha256: hash(await Bun.file(import.meta.path).arrayBuffer()),
  },
  graphs,
  scope:
    "LeagueToolkit poses sampled across original loaded-resource frame counts, including endpoints. Native pose interpolation, transforms, graph blending and A/V equivalence remain unverified.",
};
const manifestBytes = new TextEncoder().encode(JSON.stringify(result, null, 2));
await Bun.write(`${out}/manifest.json`, manifestBytes);
profile.animationPosesSha256 = hash(manifestBytes);
await Bun.write(`${root}/profile.json`, JSON.stringify(profile, null, 2));
console.log(
  JSON.stringify({
    message: message.trim(),
    graphs: Object.keys(graphs).length,
    assets: jobs.length,
    tracks,
    bytes,
  }),
);
