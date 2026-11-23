import { sha256 } from "./structural-comparison.mjs";
import {
  assertDirectCompiledDataGraph,
  sameDirectCompiledData,
} from "./latest-direct-compiled-restore.mjs";
import { assertLatestStaticCatalogSelection } from "./latest-static-catalog.mjs";
import { approvedEffectPacketReferenceSha } from "./latest-effect-packet-contract.mjs";

const programs = {
  placement: {
    role: "effectPlacement",
    reference: "effectPlacementReference",
  },
  descriptor: {
    role: "effectDescriptor",
    reference: "effectDescriptorReference",
  },
};
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

// Pure comparison, not package admission. Full native proof reference bytes and
// owned selected roles are required separately by the factory boundary below.
export function assertEffectPacketSceneRebinding(
  kind,
  reference,
  selected,
  scene,
  sceneSha256,
) {
  if (!Object.hasOwn(programs, kind))
    throw Error("Known original effect packet program required");
  for (const value of [reference, selected, scene])
    assertDirectCompiledDataGraph(value);
  if (
    typeof sceneSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(sceneSha256) ||
    typeof reference?.sceneManifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(reference.sceneManifestSha256) ||
    !sameDirectCompiledData(
      { ...reference, sceneManifestSha256: sceneSha256 },
      selected,
    )
  )
    throw Error(
      "Selected effect packet proof may rebind only its exact scene parent",
    );
  if (kind === "placement") {
    for (const [field, mapKey] of [
      ["mapId", "id"],
      ["mapVariant", "variant"],
      ["mapMin", "min"],
      ["mapMax", "max"],
      ["origin", "movementOrigin"],
    ])
      if (!sameDirectCompiledData(selected[field], scene.map?.[mapKey]))
        throw Error(
          "Selected packet placement requires the original map quantization domain",
        );
  }
}

export async function assertLatestSelectedEffectPacket({
  selection,
  kind,
  profile,
  packageBytes,
  sceneBytes,
}) {
  assertLatestStaticCatalogSelection(selection);
  if (!Object.hasOwn(programs, kind))
    throw Error("Known original effect packet program required");
  const program = programs[kind];
  await selection.assertRole(program.role, packageBytes);
  await selection.assertRole("scene", sceneBytes);
  if (!sameDirectCompiledData(profile, selection.profile()))
    throw Error("Effect packet profile differs from selected root");
  const referenceBytes = await selection.readRole(program.reference);
  const scene = decode(sceneBytes),
    reference = decode(referenceBytes);
  if (
    (await sha256(referenceBytes)) !==
    approvedEffectPacketReferenceSha(
      kind,
      scene.map?.id,
      reference.sceneManifestSha256,
    )
  )
    throw Error("Fixed original effect packet proof reference required");
  assertEffectPacketSceneRebinding(
    kind,
    reference,
    decode(packageBytes),
    scene,
    await sha256(sceneBytes),
  );
}
