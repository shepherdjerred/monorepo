// Publish build-only libraries/contracts. Native heap and replay events stay local.
import { resolve } from "node:path";
import { UNIT_FORM_INPUTS_SHA } from "../latest-unit-form-inputs.mjs";
import { UNIT_GEAR_RESOURCES_SHA } from "../latest-unit-gear-resources.mjs";
import { STARTUP_CONFIG_SHA } from "../latest-startup-config.mjs";
import { APPEARANCE_STACK_INPUTS_SHA } from "../latest-appearance-stack-inputs.mjs";
import { APPEARANCE_RESOURCES_SHA } from "../latest-appearance-resources.mjs";
import { AI_APPEARANCE_STORAGE_SHA } from "../latest-ai-appearance-storage.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  files = new Map();
for (const name of [
  "unit-form-inputs",
  "unit-gear-resources",
  "startup-config",
  "appearance-stack-inputs",
  "appearance-resources",
  "ai-appearance-storage",
]) {
  const proof = JSON.parse(
    new TextDecoder().decode(
      await raw(`${cache}/research/${name}-comparison.json`),
    ),
  );
  check(
    proof.mismatchCount === 0 &&
      proof.scope.browserBundleBuilt &&
      !proof.scope.browserExecuted &&
      !proof.scope.mainViewerExpanded,
    "Matching scoped unit effect input comparison required",
  );
  for (const [path, digest] of Object.entries(proof.inputs))
    check(
      sha(await raw(path)) === digest,
      `Unit effect evidence changed: ${path}`,
    );
  for (const [name, digest] of Object.entries(proof.sources))
    check(
      sha(await raw(`${root}/${name}`)) === digest,
      `Unit effect module changed: ${name}`,
    );
}
const diagnostic = JSON.parse(
  new TextDecoder().decode(
    await raw(`${cache}/public/evidence/latest-appearance-stack-inputs.json`),
  ),
);
check(
  diagnostic.kind === "appearance-request-diagnostic" &&
    diagnostic.scope.diagnosticOnly &&
    !diagnostic.scope.gameplayRendered &&
    !diagnostic.scope.mainViewerExpanded,
  "Scoped appearance diagnostic required",
);
check(
  sha(await raw(`${root}/tools/render-appearance-stack-inputs.py`)) ===
    diagnostic.rendererSha256,
  "Appearance diagnostic renderer changed",
);
for (const [path, digest] of Object.entries(diagnostic.inputs))
  check(
    sha(await raw(path)) === digest,
    "Appearance diagnostic evidence changed",
  );
const resourceDiagnostic = JSON.parse(
  new TextDecoder().decode(
    await raw(`${cache}/public/evidence/latest-appearance-resources.json`),
  ),
);
check(
  resourceDiagnostic.kind === "appearance-resource-selection-diagnostic" &&
    resourceDiagnostic.scope.diagnosticOnly &&
    !resourceDiagnostic.scope.gameplayRendered &&
    !resourceDiagnostic.scope.mainViewerExpanded,
  "Scoped resource selection diagnostic required",
);
check(
  sha(await raw(`${root}/tools/render-appearance-resources.py`)) ===
    resourceDiagnostic.rendererSha256,
  "Resource selection diagnostic renderer changed",
);
for (const [path, digest] of Object.entries(resourceDiagnostic.inputs))
  check(
    sha(await raw(path)) === digest,
    "Resource selection diagnostic evidence changed",
  );
const storageDiagnostic = JSON.parse(
  new TextDecoder().decode(
    await raw(`${cache}/public/evidence/latest-ai-appearance-storage.json`),
  ),
);
check(
  storageDiagnostic.kind === "ai-appearance-storage-diagnostic" &&
    storageDiagnostic.scope.diagnosticOnly &&
    !storageDiagnostic.scope.gameplayRendered &&
    !storageDiagnostic.scope.mainViewerExpanded,
  "Scoped AI storage diagnostic required",
);
check(
  sha(await raw(`${root}/tools/render-ai-appearance-storage.py`)) ===
    storageDiagnostic.rendererSha256,
  "AI storage diagnostic renderer changed",
);
for (const [path, digest] of Object.entries(storageDiagnostic.inputs))
  check(
    sha(await raw(path)) === digest,
    "AI storage diagnostic evidence changed",
  );
for (const [url, path, digest] of [
  [
    "/latest-ai-appearance-storage.mjs",
    `${root}/latest-ai-appearance-storage.mjs`,
    null,
  ],
  [
    "/assets/latest-ai-appearance-storage/package.json",
    `${cache}/public/latest-ai-appearance-storage/package.json`,
    AI_APPEARANCE_STORAGE_SHA,
  ],
  [
    "/assets/evidence/latest-ai-appearance-storage.png",
    `${cache}/public/evidence/latest-ai-appearance-storage.png`,
    storageDiagnostic.imageSha256,
  ],
  [
    "/latest-appearance-resources.mjs",
    `${root}/latest-appearance-resources.mjs`,
    null,
  ],
  [
    "/assets/latest-appearance-resources/package.json",
    `${cache}/public/latest-appearance-resources/package.json`,
    APPEARANCE_RESOURCES_SHA,
  ],
  [
    "/assets/evidence/latest-appearance-resources.png",
    `${cache}/public/evidence/latest-appearance-resources.png`,
    resourceDiagnostic.imageSha256,
  ],
  ["/latest-unit-form-inputs.mjs", `${root}/latest-unit-form-inputs.mjs`, null],
  [
    "/latest-unit-gear-resources.mjs",
    `${root}/latest-unit-gear-resources.mjs`,
    null,
  ],
  ["/structural-comparison.mjs", `${root}/structural-comparison.mjs`, null],
  ["/latest-startup-config.mjs", `${root}/latest-startup-config.mjs`, null],
  [
    "/latest-appearance-stack-inputs.mjs",
    `${root}/latest-appearance-stack-inputs.mjs`,
    null,
  ],
  [
    "/assets/latest-appearance-stack-inputs/package.json",
    `${cache}/public/latest-appearance-stack-inputs/package.json`,
    APPEARANCE_STACK_INPUTS_SHA,
  ],
  [
    "/assets/evidence/latest-appearance-stack-inputs.png",
    `${cache}/public/evidence/latest-appearance-stack-inputs.png`,
    diagnostic.imageSha256,
  ],
  [
    "/assets/latest-startup-config/package.json",
    `${cache}/public/latest-startup-config/package.json`,
    STARTUP_CONFIG_SHA,
  ],
  [
    "/assets/latest-unit-form-inputs/package.json",
    `${cache}/public/latest-unit-form-inputs/package.json`,
    UNIT_FORM_INPUTS_SHA,
  ],
  [
    "/assets/latest-unit-gear-resources/package.json",
    `${cache}/public/latest-unit-gear-resources/package.json`,
    UNIT_GEAR_RESOURCES_SHA,
  ],
]) {
  const bytes = await raw(path);
  check(
    !digest || sha(bytes) === digest,
    `Unit effect publication hash differs: ${url}`,
  );
  files.set(url, { sha256: sha(bytes), bytes: bytes.length });
}
let httpChecks = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
])
  for (const [url, file] of files) {
    const response = await fetch(base + url, {
      signal: AbortSignal.timeout(15000),
    });
    check(
      response.status === 200,
      `Unit effect HTTP ${response.status}: ${url}`,
    );
    check(
      sha(new Uint8Array(await response.arrayBuffer())) === file.sha256,
      `Unit effect HTTP bytes differ: ${url}`,
    );
    httpChecks++;
  }
await Bun.write(
  `${cache}/research/unit-effect-inputs-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "private-unit-effect-inputs-publication",
      inputs,
      files: Object.fromEntries(files),
      counts: { files: files.size, httpChecks },
      scope: {
        staticLibrariesContractsAndDiagnosticOnly: true,
        containsReplayEvents: false,
        containsUnitSnapshots: false,
        mainViewerExpanded: false,
        browserExecuted: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ files: files.size, httpChecks }));
