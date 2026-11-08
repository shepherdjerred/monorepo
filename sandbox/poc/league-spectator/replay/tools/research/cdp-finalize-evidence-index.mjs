const base = ".cache/replay-spike/research/",
  path = base + "browser-cdp-v37-evidence-index.json",
  r = await Bun.file(path).json();
r.finalSourceVerification = {
  tests: 639,
  assertions: 11574,
  testFiles: 139,
  failures: 0,
  bundles: {
    viewerBytes: 1315310,
    directWorkerBytes: 757032,
    targetedWorkerBytes: 483489,
    effectsWorkerEmulationFree: true,
    targetedWorkerEmulationFree: true,
  },
  sourceFilesBeforeAfter: 1568,
  sourceChangedDuringVerification: 0,
};
for (const name of [
  "v37-tests-final-post-diagnostics.log",
  "v37-bundles-final-post-diagnostics.log",
  "v37-source-final-post-diagnostics-before.json",
  "v37-source-final-post-diagnostics-after.json",
]) {
  const b = await Bun.file(base + name).bytes();
  r.artifacts.push({
    path: base + name,
    bytes: b.length,
    sha256: new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  });
}
await Bun.write(path, JSON.stringify(r, null, 2));
console.log(
  JSON.stringify({
    output: path,
    sha256: new Bun.CryptoHasher("sha256")
      .update(await Bun.file(path).bytes())
      .digest("hex"),
    artifacts: r.artifacts.length,
  }),
);
