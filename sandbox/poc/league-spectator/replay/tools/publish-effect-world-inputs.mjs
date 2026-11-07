// Publish only the build-specific contract, browser library and diagnostic.
// Replay bytes, unit snapshots and invalidated factory reports stay in research.
import { resolve } from "node:path";
import { EFFECT_WORLD_INPUTS_SHA } from "../latest-effect-world-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  proof = await read(`${cache}/research/effect-world-inputs-comparison.json`),
  visual = await read(`${assets}/evidence/latest-effect-world-inputs.json`),
  files = new Map();
check(
  proof.mismatchCount === 0 &&
    proof.counts.pointerFieldsCompared === 44 &&
    proof.counts.creationJoins === 2224 &&
    proof.counts.entityQueries === 6672 &&
    proof.counts.ownerBindingRejections === 1833 &&
    proof.counts.formerThreeFieldFalseAdmissions === 466 &&
    !proof.scope.liveWorldReconstructed &&
    !proof.scope.factoryExecuted,
  "Complete scoped original world-input comparisons required",
);
for (const [name, digest] of Object.entries(proof.sources))
  check(
    sha(await raw(`${root}/${name}`)) === digest,
    `World input source changed: ${name}`,
  );
for (const report of [proof, visual])
  for (const [path, digest] of Object.entries(report.inputs))
    check(
      sha(await raw(path)) === digest,
      `World input evidence changed: ${path}`,
    );
check(
  visual.scope.diagnosticOnly &&
    !visual.scope.gameplayRendered &&
    !visual.scope.mainViewerExpanded &&
    sha(await raw(`${root}/tools/render-effect-world-inputs.py`)) ===
      visual.rendererSha256,
  "Scoped world input diagnostic required",
);
for (const [url, path, digest] of [
  [
    "/latest-effect-world-inputs.mjs",
    `${root}/latest-effect-world-inputs.mjs`,
    proof.sources["latest-effect-world-inputs.mjs"],
  ],
  [
    "/assets/latest-effect-world-inputs/package.json",
    `${assets}/latest-effect-world-inputs/package.json`,
    EFFECT_WORLD_INPUTS_SHA,
  ],
  [
    "/assets/evidence/latest-effect-world-inputs.png",
    `${assets}/evidence/latest-effect-world-inputs.png`,
    visual.imageSha256,
  ],
  [
    "/assets/evidence/latest-effect-world-inputs.json",
    `${assets}/evidence/latest-effect-world-inputs.json`,
    null,
  ],
]) {
  const b = await raw(path);
  check(
    !digest || sha(b) === digest,
    `World input publication hash differs: ${url}`,
  );
  files.set(url, { sha256: sha(b), bytes: b.length });
}
let httpChecks = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  for (const [url, file] of files) {
    const response = await fetch(base + url, {
      signal: AbortSignal.timeout(15000),
    });
    check(
      response.status === 200,
      `World input HTTP ${response.status}: ${url}`,
    );
    check(
      sha(new Uint8Array(await response.arrayBuffer())) === file.sha256,
      `World input HTTP bytes differ: ${url}`,
    );
    httpChecks++;
  }
}
await Bun.write(
  `${cache}/research/effect-world-inputs-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "private-effect-world-input-publication",
      inputs,
      files: Object.fromEntries(files),
      counts: { files: files.size, httpChecks },
      scope: {
        staticContractAndLibrary: true,
        diagnosticOnly: true,
        liveWorldReconstructed: false,
        mainViewerExpanded: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ files: files.size, httpChecks }));
