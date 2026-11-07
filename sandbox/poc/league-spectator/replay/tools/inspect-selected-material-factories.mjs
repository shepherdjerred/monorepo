// Actual registry/compiler factories; in-memory catalog extension before publication.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { loadLatestSelectedMaterialRegistry } from "../latest-selected-materials.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [primaryArg, secondaryArg] = process.argv.slice(2);
if (!primaryArg || !secondaryArg || process.argv.length !== 4)
  throw Error(
    "Usage: inspect-selected-material-factories.mjs <primary> <secondary>",
  );
const inputs = {},
  encode = (o) => new TextEncoder().encode(JSON.stringify(o)),
  decode = (b) => JSON.parse(new TextDecoder().decode(b));
async function raw(p) {
  p = resolve(p);
  const b = await Bun.file(p).bytes();
  const h = await sha256(b);
  if (inputs[p] && inputs[p] !== h) throw Error("Factory input changed");
  inputs[p] = h;
  return b;
}
await captureDirectSourceInputs([import.meta.path], raw);
const results = [];
for (const [cacheArg, mode] of [
  [primaryArg, "fixed-original-complete"],
  [secondaryArg, "native-quad-partial"],
]) {
  const cache = resolve(cacheArg),
    root = resolve(cache, "public"),
    read = (p) => raw(`${root}/${p}`),
    bootstrap = decode(await read("latest-static-catalog/bootstrap.json")),
    catalog = decode(await read(bootstrap.catalog.path));
  const roles = {
    selectedMaterials: "latest-selected-materials/package.json",
    quadGpu: "latest-complete-quad-gpu/package.json",
    ...(mode === "fixed-original-complete"
      ? {
          trailGpu: "latest-trail-particles/gpu.json",
          erosionGpu: "latest-quad-erosion-gpu/package.json",
        }
      : {
          nativeQuadMaterials:
            "latest-selected-materials/native-materials.json",
          nativeMaterialReference:
            "latest-selected-materials/native-material-reference.json",
          boundQuads: "decoder-16.21-macos/vfx-bound-quads.json",
          shaderPackage: "latest-shaders/package.json",
          shaderPairs: "latest-selected-materials/shader-pairs.json",
          particleColor: "latest-particle-color/package.json",
          particleColorReference:
            "latest-selected-materials/particle-color-reference.json",
        }),
  };
  if (mode === "native-quad-partial")
    Object.assign(
      catalog.files,
      decode(await read("latest-selected-materials/files.json")).files,
    );
  for (const [role, p] of Object.entries(roles)) {
    const b = await read(p);
    catalog.roles[role] = p;
    catalog.files[p] = { sha256: await sha256(b), bytes: b.length };
  }
  const cb = encode(catalog);
  bootstrap.catalog.sha256 = await sha256(cb);
  const bb = encode(bootstrap),
    load = async (p) =>
      p === "latest-static-catalog/bootstrap.json"
        ? bb
        : p === bootstrap.catalog.path
          ? cb
          : read(p);
  const selection = await loadLatestStaticCatalogSelection({ load }),
    registry = await loadLatestSelectedMaterialRegistry({
      staticCatalog: selection,
      load,
    });
  if (registry.mode !== mode) throw Error("Wrong material mode");
  const manifestBytes = await read("latest-effects/manifest.json"),
    manifest = decode(manifestBytes),
    ids =
      mode === "fixed-original-complete"
        ? (
            await Bun.file(
              resolve(cache, "research/direct-effects.json"),
            ).json()
          ).definitions.map((d) => d.id)
        : Object.keys(manifest.definitions);
  const prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    effectIds: ids,
    staticCatalog: selection,
  });
  if (mode === "fixed-original-complete") {
    const original = await loadLatestDirectEffectPackage({
      load: read,
      manifestBytes,
      effectIds: ids,
    });
    if (
      !sameDirectCompiledData(
        [...prepared.definitions],
        [...original.definitions],
      )
    )
      throw Error("Selected complete compiler differs from unchanged default");
    if (
      !sameDirectCompiledData([...prepared.materials], [...original.materials])
    )
      throw Error("Selected complete material inventory differs from default");
    const files = {};
    for (const [p, b] of prepared.packages.compilationInputs)
      if (p !== "decoder-16.21-macos/profile.json")
        files[p] = { sha256: await sha256(b), bytes: b.length };
    await Bun.write(
      `${root}/latest-selected-materials/files.json`,
      JSON.stringify({ schema: 1, mode, files }, null, 2),
    );
  }
  const negatives = [];
  try {
    await registry.assertPackages({
      effectsManifestBytes: manifestBytes,
      quadPackageBytes: registry.packageBytes("quad"),
      trailPackageBytes:
        mode === "fixed-original-complete" ? undefined : new Uint8Array(),
      erosionPackageBytes: registry.packageBytes("erosion"),
    });
    throw Error("Invalid family bytes accepted");
  } catch (e) {
    if (e.message === "Invalid family bytes accepted") throw e;
    negatives.push(e.message);
  }
  // These attacks retain the trusted root. Replacing that root itself is a
  // producer/release change, outside this runtime integrity test.
  for (const [label, run] of [
    [
      "lookalike-owned-catalog",
      () =>
        loadLatestSelectedMaterialRegistry({
          staticCatalog: { ...selection },
          load,
        }),
    ],
    [
      "changed-material-bytes-under-unchanged-catalog",
      () =>
        loadLatestSelectedMaterialRegistry({
          staticCatalog: selection,
          load: async (path) => {
            const bytes = await load(path);
            if (
              path ===
              (mode === "native-quad-partial"
                ? roles.nativeQuadMaterials
                : roles.quadGpu)
            ) {
              const changed = bytes.slice();
              changed[0] ^= 1;
              return changed;
            }
            return bytes;
          },
        }),
    ],
  ]) {
    let reason = null;
    try {
      await run();
    } catch (error) {
      reason = error.message;
    }
    if (!reason)
      throw Error("Selected static integrity violation accepted: " + label);
    negatives.push({ label, reason });
  }
  const counts = {
    definitions: prepared.definitions.size,
    emitters: [...prepared.definitions.values()].reduce(
      (n, d) => n + d.emitters.length,
      0,
    ),
    unsupported: [...prepared.definitions.values()].reduce(
      (n, d) => n + d.unsupported.length,
      0,
    ),
  };
  results.push({
    mode,
    counts,
    registry: prepared.selectedMaterials.describe(),
    capturedFiles: prepared.packages.compilationInputs.length,
    negatives,
  });
  console.log(
    JSON.stringify({
      mode,
      ...counts,
      capturedFiles: prepared.packages.compilationInputs.length,
    }),
  );
}
for (const [p, h] of Object.entries(inputs))
  if ((await sha256(await Bun.file(p).bytes())) !== h)
    throw Error("Final factory source drift: " + p);
await Bun.write(
  resolve(secondaryArg, "research/selected-material-factories-control.json"),
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-selected-material-registry-and-compiler-control",
      status: "PASS",
      inputs,
      results,
      scope: {
        catalogExtension:
          "explicit in-memory role+file extension, actual published package bytes",
        nativeShaderReconstructedForEveryAdmittedSecondaryQuad: true,
        trustedSameOriginBootstrap: true,
        offlineNativeOutputsAreTrustedProducerArtifacts: true,
        boundedNumericFieldsIndependentlyDerived: true,
        arbitraryRehashedBootstrapAuthenticityEstablished: false,
        ordinaryWorkerPlayback: false,
        gpuDraw: false,
      },
    },
    null,
    2,
  ),
);
