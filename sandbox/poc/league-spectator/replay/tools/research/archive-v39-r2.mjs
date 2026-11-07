import { resolve } from "node:path";

const research = resolve(".cache/replay-spike/research"),
  secondary = resolve(".cache/replay-lineup-5667809143/research");
const parentPath = resolve(research, "direct-effects-v38-archive.json"),
  out = resolve(research, "direct-effects-v39-r2-archive.json"),
  blobdir = resolve(research, "verification-archives/v39-r2"),
  finishPath = resolve(research, "v39-r2-archive-final-inputs.json"),
  checkpointPath = resolve(research, "v39-r2-archive-source-checkpoint.json");
const hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
for (const p of [out, checkpointPath])
  if (await Bun.file(p).exists())
    throw Error("Immutable archive output already exists: " + p);
const parentBytes = await Bun.file(parentPath).bytes(),
  parent = JSON.parse(new TextDecoder().decode(parentBytes));
if (
  hash(parentBytes) !==
  "629dcad2ce90ef83327b3810623f8d0a5ff8f09878445717303fec3b00db994c"
)
  throw Error("Pinned V38 parent archive differs");
const known = new Map(parent.artifacts.map((a) => [a.sha256, a.archivePath])),
  verified = new Map(),
  metadata = new Map(),
  artifacts = [],
  missing = [],
  seen = new Set(),
  pending = [];
function dependencies(value) {
  const found = [];
  for (const map of [
    value?.inputs,
    !Array.isArray(value?.files) && value?.files,
  ])
    if (map && typeof map === "object" && !Array.isArray(map))
      for (const [path, digest] of Object.entries(map))
        if (typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest))
          found.push({ path, digest, kind: "reported-input-at-recorded-hash" });
  for (const row of value?.scripts ?? [])
    if (row.path && row.sha256)
      found.push({
        path: row.path,
        digest: row.sha256,
        kind: "served-browser-source",
      });
  for (const row of value?.results ?? [])
    if (row.output && row.sha256)
      found.push({
        path: row.output,
        digest: row.sha256,
        kind: "reported-check-output",
      });
  for (const row of [value?.before, value?.after])
    if (row?.path && row.sha256)
      found.push({
        path: row.path,
        digest: row.sha256,
        kind: "reported-source-snapshot",
      });
  if (typeof value?.image === "string" && typeof value.imageSha256 === "string")
    found.push({
      path: value.image,
      digest: value.imageSha256,
      kind: "reported-raster-image",
    });
  return found;
}
async function keep(source, expected, kind) {
  const sourcePath = resolve(source),
    key = sourcePath + "|" + (expected ?? "current");
  if (seen.has(key)) return;
  seen.add(key);
  let bytes,
    sha256 = expected,
    archivePath = expected && known.get(expected);
  if (archivePath && verified.has(expected)) {
    artifacts.push({
      sourcePath,
      archivePath,
      sha256: expected,
      bytes: verified.get(expected),
      kind,
    });
    for (const row of metadata.get(expected) ?? []) pending.push(row);
    return;
  }
  if (archivePath) {
    bytes = await Bun.file(archivePath).bytes();
    if (hash(bytes) !== expected)
      throw Error("Parent content blob corrupt: " + expected);
  } else {
    for (const path of [
      sourcePath,
      ...(expected
        ? [
            resolve(research, "browser-source-blobs", expected),
            resolve(research, "browser-source-blobs", expected + ".mjs"),
            resolve(secondary, "browser-source-blobs", expected),
            resolve(blobdir, expected),
          ]
        : []),
    ]) {
      if (!(await Bun.file(path).exists())) continue;
      const candidate = await Bun.file(path).bytes();
      if (!expected || hash(candidate) === expected) {
        bytes = candidate;
        break;
      }
    }
    if (!bytes) {
      missing.push({ sourcePath, expected: expected ?? null, kind });
      return;
    }
  }
  sha256 = hash(bytes);
  archivePath = known.get(sha256);
  if (!archivePath) {
    archivePath = resolve(blobdir, sha256);
    await Bun.write(archivePath, bytes);
    if (hash(await Bun.file(archivePath).bytes()) !== sha256)
      throw Error("Archive blob readback differs");
    known.set(sha256, archivePath);
  }
  verified.set(sha256, bytes.length);
  artifacts.push({
    sourcePath,
    archivePath,
    sha256,
    bytes: bytes.length,
    kind,
  });
  if (sourcePath.endsWith(".json")) {
    let rows = [];
    try {
      rows = dependencies(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {}
    metadata.set(sha256, rows);
    for (const row of rows) pending.push(row);
  }
}
async function closeDependencies() {
  for (let i = 0; i < pending.length; i++) {
    const r = pending[i];
    await keep(r.path, r.digest, r.kind);
  }
}
const snapshotPath = resolve(research, "v39-r2-source-final-after.json"),
  snapshotBytes = await Bun.file(snapshotPath).bytes(),
  snapshot = JSON.parse(new TextDecoder().decode(snapshotBytes));
if (
  hash(snapshotBytes) !==
    "cc596cd4c533b010e5de14ac47b7c27287c1522ba9b2982798d0aee754800fb1" ||
  Object.keys(snapshot.files).length !== 1582
)
  throw Error("Expected passing frozen V39-r2 source snapshot required");
for (const [path, digest] of Object.entries(snapshot.files)) {
  if (hash(await Bun.file(path).bytes()) !== digest)
    throw Error("Current frozen source differs: " + path);
  await keep(path, digest, "final-production-source");
}
await keep(snapshotPath, hash(snapshotBytes), "source-snapshot");
await keep(parentPath, hash(parentBytes), "preserved-parent-archive");
for (const a of parent.artifacts)
  if (
    a.kind === "canonical-current-path-bytes" ||
    a.kind === "current-bundle-or-canonical-packet-bytes"
  )
    await keep(a.sourcePath, a.sha256, "preserved-v38-session-input");
const omit = new Set([
  out,
  checkpointPath,
  resolve(research, "v39-r2-archive.log"),
]);
async function scanEvidence() {
  for (const dir of [
    research,
    secondary,
    resolve(".cache/replay-spike/visuals"),
    resolve(".cache/replay-lineup-5667809143/visuals"),
  ])
    for await (const name of new Bun.Glob("*v39*").scan({
      cwd: dir,
      onlyFiles: true,
    })) {
      const p = resolve(dir, name);
      if (!omit.has(p)) await keep(p, undefined, "versioned-v39-evidence");
    }
  const dir = resolve(research, "no-alpha-mult-v39-native-baseline");
  if (await Bun.file(resolve(dir, "index.json")).exists())
    for await (const name of new Bun.Glob("**/*").scan({
      cwd: dir,
      onlyFiles: true,
    }))
      await keep(
        resolve(dir, name),
        undefined,
        "immutable-no-alpha-mult-native-reference",
      );
  for (const pattern of [
    "browser-cdp-v38-projectile-video-v2*",
    "browser-cdp-v38-projectile-screencast*",
  ])
    for await (const name of new Bun.Glob(pattern).scan({
      cwd: research,
      onlyFiles: true,
    }))
      await keep(
        resolve(research, name),
        undefined,
        "actual-browser-media-on-frozen-v38",
      );
  for (const name of [
    "cdp-client.mjs",
    "cdp-active-play-interaction.mjs",
    "cdp-record-playback-webm.mjs",
    "cdp-projectile-screencast.mjs",
    "cdp-screencast-gif.py",
  ])
    await keep(resolve(research, name), undefined, "browser-capture-helper");
}
await scanEvidence();
await closeDependencies();
await Bun.write(
  checkpointPath,
  JSON.stringify(
    {
      stage: "frozen-source-and-existing-evidence-copied",
      sourceFiles: 1582,
      artifacts: artifacts.length,
      unavailableInputs: missing.length,
      waitingFor: finishPath,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    stage: "waiting-for-root-ui-qa-terminal",
    sourceFiles: 1582,
    artifacts: artifacts.length,
    unavailableInputs: missing.length,
    finishPath,
  }),
);
while (!(await Bun.file(finishPath).exists()))
  await new Promise((r) => setTimeout(r, 500));
const finish = await Bun.file(finishPath).json();
if (finish.uiQaTerminal !== true || !Array.isArray(finish.artifacts))
  throw Error("Explicit root UI QA terminal control required");
for (const row of finish.artifacts)
  await keep(
    typeof row === "string" ? row : row.path,
    typeof row === "string" ? undefined : row.sha256,
    "root-final-browser-ui-evidence",
  );
await keep(finishPath, undefined, "root-ui-qa-terminal-control");
await scanEvidence();
await closeDependencies();
for (const [path, digest] of Object.entries(snapshot.files))
  if (hash(await Bun.file(path).bytes()) !== digest)
    throw Error("Frozen production source changed while archiving: " + path);
if (hash(await Bun.file(parentPath).bytes()) !== hash(parentBytes))
  throw Error("Immutable V38 parent changed");
const graphs = [];
for (const name of [
  "browser-cdp-v39-smoke-1-controls.json",
  "browser-cdp-v39-primary-r2-controls.json",
]) {
  const path = resolve(research, name),
    control = await Bun.file(path).json();
  if (
    control.scripts?.length !== 227 ||
    control.scripts.some((s) => !s.path || !s.sha256)
  )
    throw Error("Complete227body browser source graph required: " + name);
  graphs.push({
    path,
    sha256: hash(await Bun.file(path).bytes()),
    servedSourceBodies: control.scripts.length,
  });
}
const manifest = {
  schema: 1,
  kind: "immutable-v39-r2-source-browser-native-and-raster-evidence-archive",
  parentArchiveSha256: hash(parentBytes),
  artifacts,
  unavailableHistoricalInputs: missing,
  browserSourceGraphs: graphs,
  inheritedUnavailableHistoricalInputs: parent.unavailableHistoricalInputs,
  counts: {
    frozenSourceFiles: 1582,
    servedSourceGraphs: graphs.length,
    servedSourceBodies: graphs.reduce((n, g) => n + g.servedSourceBodies, 0),
    artifactEntries: artifacts.length,
    unavailableInputs: missing.length,
    inheritedParentUnavailableInputs: parent.unavailableHistoricalInputs.length,
  },
  scope: {
    exactBytesCopiedAndReadBack: true,
    finalSourceInventoryRecheckedAfterCopy: true,
    reportedInputsUseRecordedHash: true,
    oldFailureEvidencePreserved: true,
    archivedV38SessionInputsPreserved: true,
    historicalSourceDriftDoesNotMeanCurrentVerification: true,
    fullAcceptanceEstablished: false,
    frameRate60Established: false,
    seekPixelParityEvidenceOnlyAtRecordedControls: true,
    nativeMatchFidelityEstablished: false,
  },
};
await Bun.write(out, JSON.stringify(manifest, null, 2));
const stored = await Bun.file(out).bytes(),
  readback = JSON.parse(new TextDecoder().decode(stored));
if (readback.artifacts.length !== artifacts.length)
  throw Error("Manifest readback differs");
console.log(
  JSON.stringify({
    stage: "terminal",
    output: out,
    sha256: hash(stored),
    ...manifest.counts,
    unavailableExamples: missing.slice(0, 6),
  }),
);
