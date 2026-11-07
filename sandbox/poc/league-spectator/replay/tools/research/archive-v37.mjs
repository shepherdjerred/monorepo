import { resolve } from "node:path";
const root = process.cwd(),
  research = resolve(".cache/replay-spike/research"),
  out = resolve(research, "direct-effects-v37-archive.json");
if (await Bun.file(out).exists())
  throw Error("Immutable V37 archive already exists");
const hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  prior = await Bun.file(
    resolve(research, "direct-effects-v36-archive.json"),
  ).json(),
  known = new Map(),
  artifacts = [],
  seen = new Set(),
  missing = [],
  queue = [];
for (const r of prior.artifacts) known.set(r.sha256, r.archivePath);
const blobdir = resolve(research, "verification-archives/v37");
async function keep(sourcePath, expected, kind) {
  sourcePath = resolve(sourcePath);
  const key = sourcePath + "|" + (expected ?? "current");
  if (seen.has(key)) return;
  seen.add(key);
  let b,
    path = sourcePath;
  if (expected && known.has(expected)) {
    path = known.get(expected);
    b = await Bun.file(path).bytes();
    if (hash(b) !== expected) throw Error("Prior blob corrupt " + path);
  } else {
    if (await Bun.file(path).exists()) {
      const candidate = await Bun.file(path).bytes();
      if (!expected || hash(candidate) === expected) b = candidate;
    }
    if (!b && expected) {
      for (const p of [
        resolve(research, "browser-source-blobs", expected),
        resolve(research, "browser-source-blobs", expected + ".mjs"),
        resolve(blobdir, expected),
      ])
        if (await Bun.file(p).exists()) {
          const candidate = await Bun.file(p).bytes();
          if (hash(candidate) === expected) {
            b = candidate;
            path = p;
            break;
          }
        }
    }
    if (!b) {
      missing.push({ sourcePath, expected, kind });
      return;
    }
  }
  const sha256 = hash(b);
  let archivePath = known.get(sha256);
  if (!archivePath) {
    archivePath = resolve(blobdir, sha256);
    await Bun.write(archivePath, b);
    if (hash(await Bun.file(archivePath).bytes()) !== sha256)
      throw Error("Archive readback differs");
    known.set(sha256, archivePath);
  }
  artifacts.push({ sourcePath, archivePath, sha256, bytes: b.length, kind });
  if (sourcePath.endsWith(".json"))
    try {
      queue.push({
        sourcePath,
        value: JSON.parse(new TextDecoder().decode(b)),
      });
    } catch {}
}
const snapshot = await Bun.file(
  resolve(research, "v37-source-final-post-diagnostics-before.json"),
).json();
for (const [p, h] of Object.entries(snapshot.files))
  await keep(p, h, "final-production-source");
const idx = await Bun.file(
  resolve(research, "browser-cdp-v37-evidence-index.json"),
).json();
await keep(
  resolve(research, "browser-cdp-v37-evidence-index.json"),
  undefined,
  "evidence-index",
);
for (const a of idx.artifacts) await keep(a.path, a.sha256, "indexed-evidence");
for (const d of [
  ".cache/replay-spike/research",
  ".cache/replay-lineup-5667809143/research",
  ".cache/replay-spike/visuals",
  ".cache/replay-lineup-5667809143/visuals",
])
  for await (const p of new Bun.Glob("*v37*").scan({
    cwd: d,
    onlyFiles: true,
  })) {
    if (p === "direct-effects-v37-archive.json") continue;
    await keep(resolve(d, p), undefined, "versioned-evidence");
  }
await Bun.write(
  resolve(research, "v37-source-archive-checkpoint.json"),
  JSON.stringify(
    {
      sourceFiles: Object.keys(snapshot.files).length,
      sourceArtifacts: artifacts.filter(
        (x) => x.kind === "final-production-source",
      ).length,
      sourceSnapshotSha256: hash(
        await Bun.file(
          resolve(research, "v37-source-final-post-diagnostics-before.json"),
        ).bytes(),
      ),
      artifacts: artifacts.length,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    stage: "source-and-artifact-checkpoint",
    artifacts: artifacts.length,
    missing: missing.length,
  }),
);
for (let i = 0; i < queue.length; i++) {
  const { sourcePath, value } = queue[i];
  if (
    value?.inputs &&
    typeof value.inputs === "object" &&
    !Array.isArray(value.inputs)
  )
    for (const [p, h] of Object.entries(value.inputs))
      if (typeof h === "string" && /^[a-f0-9]{64}$/.test(h))
        await keep(p, h, "reported-input");
  if (Array.isArray(value?.scripts))
    for (const r of value.scripts)
      if (r.path && r.sha256)
        await keep(r.path, r.sha256, "served-browser-source");
}
const manifest = {
  schema: 1,
  kind: "immutable-v37-source-browser-native-and-raster-evidence-archive",
  parentArchiveSha256: hash(
    await Bun.file(
      resolve(research, "direct-effects-v36-archive.json"),
    ).bytes(),
  ),
  artifacts,
  unavailableHistoricalInputs: missing,
  scope: {
    finalProductionSourcesArchived: true,
    reportedInputsUseRecordedHash: true,
    historicalSourceDriftDoesNotMeanCurrentVerification: true,
    fullAcceptanceEstablished: false,
  },
};
await Bun.write(out, JSON.stringify(manifest, null, 2));
const b = await Bun.file(out).bytes();
console.log(
  JSON.stringify({
    stage: "done",
    output: out,
    sha256: hash(b),
    artifacts: artifacts.length,
    unavailable: missing.length,
    examples: missing.slice(0, 5),
  }),
);
