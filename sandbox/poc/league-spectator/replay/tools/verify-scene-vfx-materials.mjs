import path from "node:path";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";
import {
  validateSceneMaterialRows,
  sceneMaterialIdentity,
} from "../scene-vfx-material-data.mjs";
import { sameDirectCompiledData as same } from "../latest-direct-compiled-restore.mjs";
import {
  SCENE_VFX_MATERIAL_SOURCES,
  SCENE_VFX_INITIALIZER,
} from "../scene-vfx-material-contract.mjs";

const [nativePackageArg, nativeArg, materialArg] = process.argv.slice(2);
if (!materialArg)
  throw Error(
    "Usage: bun verify-scene-vfx-materials.mjs <approved-native-package> <native-authority> <material-authority>",
  );
const decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  nativeBytes = await Bun.file(path.join(nativeArg, "manifest.json")).bytes(),
  native = decode(nativeBytes),
  materialBytes = await Bun.file(
    path.join(materialArg, "manifest.json"),
  ).bytes(),
  materials = decode(materialBytes),
  image = await Bun.file(path.join(nativePackageArg, "image.bin")).bytes();
if (
  materials.kind !== "original-scene-vfx-material-authority" ||
  materials.nativeAuthoritySha256 !== sha(nativeBytes) ||
  materials.sceneManifestSha256 !== native.sceneManifestSha256 ||
  materials.effectsManifestSha256 !== native.effectsManifestSha256 ||
  materials.nativeSpectatorAdmitted !== false ||
  !materials.scope.completeEligibleGraphInventory ||
  materials.scope.actualScenePredicates !== false ||
  !same(materials.sources, SCENE_VFX_MATERIAL_SOURCES)
)
  throw Error("Exact original material authority required");
for (const [file, digest] of Object.entries(materials.sources))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error("Original material evaluator source changed: " + file);
const { rows } = validateSceneMaterialRows(materials, native),
  verified = new Set(),
  selected = new Map(materials.files.map((file) => [file.file, file])),
  statuses = {};
for (const file of selected.values()) {
  sceneAnimationFilePath(file.file);
  const bytes = await Bun.file(path.join(materialArg, file.file)).bytes();
  if (bytes.length !== file.bytes || sha(bytes) !== file.sha256)
    throw Error("Original material worker receipt changed");
}
for (const child of materials.children) {
  const expected = selected.get(child.file);
  if (!same(expected, child))
    throw Error("Original material worker outside closed inventory");
  const proof = decode(
    await Bun.file(path.join(materialArg, child.file)).bytes(),
  );
  if (
    proof.kind !== "original-scene-vfx-material-observations" ||
    proof.nativeAuthoritySha256 !== sha(nativeBytes) ||
    proof.decoderImageSha256 !== sha(image) ||
    !same(proof.runtime, materials.runtime) ||
    !same(proof.initializer, {
      range: [SCENE_VFX_INITIALIZER.start, SCENE_VFX_INITIALIZER.end],
      sha256: SCENE_VFX_INITIALIZER.sha256,
    }) ||
    !same(
      proof.sources,
      Object.fromEntries(
        Object.entries(materials.sources).filter(
          ([file]) => file !== "prepare-scene-vfx-materials.py",
        ),
      ),
    )
  )
    throw Error(
      "Original material worker program/runtime/initializer identity differs",
    );
  for (const record of proof.emitters) {
    const key = sceneMaterialIdentity(record),
      actual = rows.get(key);
    if (verified.has(key) || !actual)
      throw Error("Original material worker identity duplicated/missing");
    verified.add(key);
    const expanded = (row) => ({
      ...row,
      probes: row.probes?.map((probe) => ({
        input: probe.input,
        result: (row === record ? proof : materials).resultCatalog[
          probe.result
        ],
      })),
    });
    if (!same(expanded(record), expanded(actual)))
      throw Error(
        "Material master row differs from original worker observation",
      );
    statuses[record.status] = (statuses[record.status] ?? 0) + 1;
  }
  for (const block of proof.originalBlocks)
    if (
      !Number.isSafeInteger(block.rva) ||
      !Number.isSafeInteger(block.size) ||
      block.rva < 0 ||
      block.size <= 0 ||
      block.rva + block.size > image.length ||
      sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256
    )
      throw Error("Original material instruction identity differs");
}
if (verified.size !== rows.size || !same(statuses, materials.statuses))
  throw Error("Original material worker coverage/statuses incomplete");
console.log(
  JSON.stringify({
    materialAuthoritySha256: sha(materialBytes),
    emitters: verified.size,
    workerReceipts: selected.size,
    statuses,
    nativeSpectatorAdmitted: false,
  }),
);
