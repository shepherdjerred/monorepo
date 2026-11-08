import { resolve } from "node:path";

const research = resolve(".cache/replay-spike/research"),
  secondary = resolve(".cache/replay-lineup-5667809143/research"),
  out = resolve(research, "direct-effects-v38-archive.json"),
  blobdir = resolve(research, "verification-archives/v38"),
  parentPath = resolve(research, "direct-effects-v37-archive.json"),
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (await Bun.file(out).exists())
  throw Error("Immutable V38 archive already exists");
const parentBytes = await Bun.file(parentPath).bytes(),
  parent = JSON.parse(new TextDecoder().decode(parentBytes));
if (
  hash(parentBytes) !==
  "a7afa15e6b0321add6b66bc3c8b5230c2d57d943a727a6520c4752db81b52ea8"
)
  throw Error("Original closed V37 parent archive differs");
const known = new Map(
    parent.artifacts.map((entry) => [entry.sha256, entry.archivePath]),
  ),
  artifacts = [],
  missing = [],
  seen = new Set(),
  queue = [];
async function keep(source, expected, kind) {
  const sourcePath = resolve(source),
    key = sourcePath + "|" + (expected ?? "current");
  if (seen.has(key)) return;
  seen.add(key);
  let bytes;
  if (expected && known.has(expected)) {
    bytes = await Bun.file(known.get(expected)).bytes();
    if (hash(bytes) !== expected)
      throw Error("Prior content-addressed blob corrupt: " + expected);
  } else {
    if (await Bun.file(sourcePath).exists()) {
      const candidate = await Bun.file(sourcePath).bytes();
      if (!expected || hash(candidate) === expected) bytes = candidate;
    }
    if (!bytes && expected)
      for (const path of [
        resolve(research, "browser-source-blobs", expected),
        resolve(research, "browser-source-blobs", expected + ".mjs"),
        resolve(secondary, "browser-source-blobs", expected),
        resolve(blobdir, expected),
      ])
        if (await Bun.file(path).exists()) {
          const candidate = await Bun.file(path).bytes();
          if (hash(candidate) === expected) {
            bytes = candidate;
            break;
          }
        }
    if (!bytes) {
      missing.push({ sourcePath, expected: expected ?? null, kind });
      return;
    }
  }
  const sha256 = hash(bytes);
  let archivePath = known.get(sha256);
  if (!archivePath) {
    archivePath = resolve(blobdir, sha256);
    await Bun.write(archivePath, bytes);
    if (hash(await Bun.file(archivePath).bytes()) !== sha256)
      throw Error("V38 content blob readback differs");
    known.set(sha256, archivePath);
  }
  artifacts.push({
    sourcePath,
    archivePath,
    sha256,
    bytes: bytes.length,
    kind,
  });
  if (sourcePath.endsWith(".json")) {
    try {
      queue.push({
        sourcePath,
        value: JSON.parse(new TextDecoder().decode(bytes)),
      });
    } catch {}
  }
}
const proc = Bun.spawn(
  [
    "rg",
    "--files",
    "sandbox/poc/league-spectator/replay",
    "-g",
    "*.mjs",
    "-g",
    "*.js",
    "-g",
    "*.ts",
    "-g",
    "*.py",
    "-g",
    "*.html",
    "-g",
    "*.json",
    "-g",
    "*.md",
  ],
  { stdout: "pipe", stderr: "inherit" },
);
const paths = (await new Response(proc.stdout).text())
  .trim()
  .split(/\r?\n/)
  .sort();
if ((await proc.exited) !== 0 || paths.length < 1500)
  throw Error("Complete frozen spike source inventory required");
const files = {};
for (const path of paths) {
  const bytes = await Bun.file(path).bytes();
  files[path] = hash(bytes);
  await keep(path, files[path], "final-production-source");
}
const snapshotPath = resolve(research, "v38-source-archive-snapshot.json");
if (await Bun.file(snapshotPath).exists())
  throw Error("V38 frozen source snapshot already exists");
await Bun.write(
  snapshotPath,
  JSON.stringify(
    { schema: 1, kind: "v38-frozen-source-archive-snapshot", files },
    null,
    2,
  ),
);
await keep(snapshotPath, undefined, "source-snapshot");
await keep(parentPath, hash(parentBytes), "preserved-parent-archive");
for (const dir of [
  research,
  secondary,
  resolve(".cache/replay-spike/visuals"),
  resolve(".cache/replay-lineup-5667809143/visuals"),
])
  for await (const name of new Bun.Glob("*v38*").scan({
    cwd: dir,
    onlyFiles: true,
  })) {
    if (resolve(dir, name) !== out)
      await keep(resolve(dir, name), undefined, "versioned-v38-evidence");
  }
for (const dir of [
  resolve(research, "v38-basis-preintegration"),
  resolve(secondary, "v38-regression-baseline"),
])
  for await (const name of new Bun.Glob("**/*").scan({
    cwd: dir,
    onlyFiles: true,
  }))
    await keep(
      resolve(dir, name),
      undefined,
      "immutable-preintegration-reference",
    );
for (const dir of [research, secondary])
  for (const name of [
    "selected-reconstruction-control.json",
    "selected-ordinary-reconstruction.json",
    "viewer-root-reconstruction.json",
    "direct-session-selected-control.json",
    "direct-session-selected-control-playback.json",
  ])
    if (await Bun.file(resolve(dir, name)).exists())
      await keep(resolve(dir, name), undefined, "canonical-current-path-bytes");
for await (const name of new Bun.Glob("browser-cdp-v37*").scan({
  cwd: research,
  onlyFiles: true,
}))
  await keep(
    resolve(research, name),
    undefined,
    "final-seek-gpu-and-latency-diagnostics",
  );
for (const name of ["cdp-client.mjs", "cdp-v38-visual-gif.py"])
  await keep(resolve(research, name), undefined, "browser-capture-helper");
for (const dir of [research, secondary])
  for (const relative of [
    "direct-session-selected-control.bundle.mjs",
    "shared-direct-playback-worker.json",
    "shared-direct-playback-offscreen.json",
  ])
    if (await Bun.file(resolve(dir, relative)).exists())
      await keep(
        resolve(dir, relative),
        undefined,
        "current-bundle-or-canonical-packet-bytes",
      );
const browser = await Bun.file(
  resolve(research, "browser-cdp-v38-primary-controls.json"),
).json();
if (browser.scripts?.length !== 224)
  throw Error("Expected exact final ordinary browser224 served source bodies");
for (const script of browser.scripts)
  await keep(script.path, script.sha256, "served-browser-source");
console.log(
  JSON.stringify({
    stage: "source-and-evidence-checkpoint",
    sources: paths.length,
    artifacts: artifacts.length,
    missing: missing.length,
  }),
);
for (let i = 0; i < queue.length; i++) {
  const { value } = queue[i];
  if (
    value?.inputs &&
    typeof value.inputs === "object" &&
    !Array.isArray(value.inputs)
  )
    for (const [path, digest] of Object.entries(value.inputs))
      if (typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest))
        await keep(path, digest, "reported-input-at-recorded-hash");
  if (Array.isArray(value?.scripts))
    for (const script of value.scripts)
      if (script.path && script.sha256)
        await keep(script.path, script.sha256, "served-browser-source");
  if (typeof value?.image === "string" && typeof value.imageSha256 === "string")
    await keep(value.image, value.imageSha256, "report-owned-raster-image");
}
for (const [path, digest] of Object.entries(files))
  if (hash(await Bun.file(path).bytes()) !== digest)
    throw Error("Frozen V38 source changed during archival: " + path);
if (hash(await Bun.file(parentPath).bytes()) !== hash(parentBytes))
  throw Error("Historical V37 manifest changed");
const manifest = {
  schema: 1,
  kind: "immutable-v38-source-browser-native-and-raster-evidence-archive",
  parentArchiveSha256: hash(parentBytes),
  artifacts,
  unavailableHistoricalInputs: missing,
  counts: {
    frozenSourceFiles: paths.length,
    servedPrimaryBrowserSourceBodies: browser.scripts.length,
    artifactEntries: artifacts.length,
    unavailableInputs: missing.length,
    inheritedUnavailableHistoricalInputs:
      parent.unavailableHistoricalInputs.length,
  },
  scope: {
    exactBytesCopiedAndReadBack: true,
    finalProductionSourcesArchived: true,
    finalSourceInventoryRecheckedAfterCopy: true,
    reportedInputsUseRecordedHash: true,
    primaryAndSecondaryEvidence: true,
    v37Preserved: true,
    historicalSourceDriftDoesNotMeanCurrentVerification: true,
    fullAcceptanceEstablished: false,
    frameRate60Established: false,
    seekPixelParityEstablished: false,
  },
};
await Bun.write(out, JSON.stringify(manifest, null, 2));
const stored = await Bun.file(out).bytes(),
  parsed = JSON.parse(new TextDecoder().decode(stored));
if (parsed.artifacts.length !== artifacts.length)
  throw Error("Manifest readback entry count differs");
console.log(
  JSON.stringify({
    stage: "terminal",
    output: out,
    sha256: hash(stored),
    ...manifest.counts,
    unavailableExamples: missing.slice(0, 8),
  }),
);
