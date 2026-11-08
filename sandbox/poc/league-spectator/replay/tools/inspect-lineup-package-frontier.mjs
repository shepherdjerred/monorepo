// Read-only inventory of selected-content pins that block another static lineup.
import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const source = resolve(process.argv[2] ?? ".cache/replay-spike"),
  target = resolve(process.argv[3] ?? ".cache/replay-lineup-5667809143"),
  root = resolve(import.meta.dir, ".."),
  inputs = {};
async function raw(path) {
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
}
const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
await raw(import.meta.path);
const ordinarySources = new Set(
  await captureDirectSourceInputs(
    [
      resolve(root, "latest-direct-effect-session.mjs"),
      resolve(root, "latest-direct-effect-worker.mjs"),
      resolve(root, "latest-targeted-missile-worker.mjs"),
    ],
    raw,
  ),
);
const constants = [];
for (const name of await readdir(root)) {
  if (!name.endsWith(".mjs") || name.endsWith(".test.mjs")) continue;
  const path = resolve(root, name),
    text = new TextDecoder().decode(await raw(path));
  for (const match of text.matchAll(
    /export const ([A-Z][A-Z0-9_]*(?:SHA|SHA256))\s*=\s*"([a-f0-9]{64})"/g,
  ))
    constants.push({
      name: match[1],
      hash: match[2],
      consumer: path,
      line: text.slice(0, match.index).split("\n").length,
    });
}
const packages = [];
for (const dir of await readdir(`${source}/public`, { withFileTypes: true })) {
  if (!dir.isDirectory() || !dir.name.startsWith("latest-")) continue;
  for (const filename of ["package.json", "gpu.json"]) {
    const path = resolve(source, "public", dir.name, filename);
    if (!(await Bun.file(path).exists())) continue;
    const bytes = await raw(path),
      digest = await sha256(bytes),
      data = decode(bytes),
      selected = constants.filter((row) => row.hash === digest);
    if (!selected.length) continue;
    const pins = {};
    for (const [key, value] of Object.entries(data))
      if (/manifestsha256|scene.*sha256/i.test(key)) pins[key] = value;
    packages.push({
      path,
      sha256: digest,
      kind: data.kind ?? null,
      pins,
      constants: selected,
      ordinarySessionImportClosure: selected.some((row) =>
        ordinarySources.has(row.consumer),
      ),
      counts: data.counts ?? null,
      selectedRecordCounts: Object.fromEntries(
        Object.entries(data)
          .filter(
            ([key, value]) =>
              [
                "contexts",
                "actors",
                "emitters",
                "components",
                "models",
                "definitions",
              ].includes(key) &&
              value &&
              typeof value === "object",
          )
          .map(([key, value]) => [key, Object.keys(value).length]),
      ),
      requiresContentReview: true,
    });
  }
}
const artifacts = {};
for (const name of [
  "latest-scene/manifest.json",
  "latest-effects/manifest.json",
  "latest-effect-contexts/package.json",
  "latest-effect-resolvers/package.json",
  "latest-viewer-poses/package.json",
]) {
  const path = resolve(target, "public", name),
    bytes = await raw(path),
    data = decode(bytes);
  artifacts[name] = {
    path,
    sha256: await sha256(bytes),
    counts: data.counts ?? null,
    selectedRecordCounts: Object.fromEntries(
      Object.entries(data)
        .filter(
          ([key, value]) =>
            [
              "contexts",
              "actors",
              "emitters",
              "champions",
              "models",
              "definitions",
              "assets",
            ].includes(key) &&
            value &&
            typeof value === "object",
        )
        .map(([key, value]) => [key, Object.keys(value).length]),
    ),
  };
}
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Package inventory source changed: " + path);
const output = resolve(target, "research/selected-package-frontier.json");
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "isolated-lineup-selected-package-integration-frontier",
      inputs,
      primaryPinnedPackages: packages,
      ordinarySessionSources: [...ordinarySources].sort(),
      isolatedArtifacts: artifacts,
      proposal: {
        invariantAuthority:
          "Keep exact build/protocol/decoder image, original algorithm block digests, validator schema/policy IDs and GPU vendor/math source pins independent of resource selection.",
        contentAuthority:
          "A source-owned selected static catalog binds scene/effects manifest digests and every required typed package digest; expose a branded selection from the verified static loader, never a free caller hash or a hash declared by the candidate package itself.",
        preservation:
          "Register a separate reviewed static-catalog identity alongside the existing primary identity; preserve existing constant bytes and package validation, then pass the owned selected expected digest through loaders and full worker recompilation.",
        admission:
          "Regenerated native observations and complete package input closure must establish the new catalog. A matching manifest digest or freshly compiled shader does not establish component material admission.",
        initialization:
          "Transfer selected catalog bytes plus all captured static inputs, re-create the same selection inside both ordinary workers, and compare complete derived inventory before activation.",
        negativeControls: [
          "foreign scene/effects catalog",
          "self-declared package hash",
          "stale native observation",
          "definition hash mismatch",
          "missing package",
          "primary package changed by second catalog",
          "worker selection differs from host",
        ],
      },
      scope: {
        productionLoadersChanged: false,
        primaryAssetsChanged: false,
        actualRuntimeCoverageEstablished: false,
        isolatedOrdinarySessionBlockedUntilSelectedPackageIntegration: true,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    constantBoundPackages: packages.length,
    explicitManifestBound: packages.filter((p) => Object.keys(p.pins).length)
      .length,
    isolatedArtifacts: Object.keys(artifacts).length,
  }),
);
