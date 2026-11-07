// Rebinding a verified world schema to another scene does not approve new
// classes, world assets or native instructions. Only the scene parent changes.
import { sha256 } from "./structural-comparison.mjs";
import {
  assertDirectCompiledDataGraph,
  sameDirectCompiledData,
} from "./latest-direct-compiled-restore.mjs";
import { assertLatestStaticCatalogSelection } from "./latest-static-catalog.mjs";
import { WORLD_STATE_SHA } from "./latest-world-state-contract.mjs";

const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

// Pure contract check only; this function cannot authorize a package. The
// consumer below separately requires an owned selection and the fixed proof.
export function assertWorldStateSceneRebinding(
  reference,
  selected,
  sceneSha256,
) {
  assertDirectCompiledDataGraph(reference);
  assertDirectCompiledDataGraph(selected);
  if (
    !reference ||
    !selected ||
    Array.isArray(reference) ||
    Array.isArray(selected) ||
    !digest(reference.sceneManifestSha256) ||
    !digest(sceneSha256) ||
    selected.sceneManifestSha256 !== sceneSha256 ||
    !sameDirectCompiledData(
      { ...reference, sceneManifestSha256: sceneSha256 },
      selected,
    )
  )
    throw Error("Selected world schema may rebind only its exact scene parent");
}

export async function assertLatestSelectedWorldState({
  selection,
  profile,
  packageBytes,
  sceneBytes,
  catalogBytes,
}) {
  assertLatestStaticCatalogSelection(selection);
  await selection.assertRole("worldState", packageBytes);
  await selection.assertRole("scene", sceneBytes);
  if (!sameDirectCompiledData(profile, selection.profile()))
    throw Error("World schema profile differs from selected static root");
  const referenceBytes = await selection.readRole("worldStateReference");
  if ((await sha256(referenceBytes)) !== WORLD_STATE_SHA)
    throw Error("Original approved world schema reference required");
  const scene = decode(sceneBytes);
  if (
    typeof scene.world !== "string" ||
    !sameDirectCompiledData(
      await selection.read(`latest-scene/${scene.world}`),
      catalogBytes,
    )
  )
    throw Error("World catalog differs from selected scene resources");
  assertWorldStateSceneRebinding(
    decode(referenceBytes),
    decode(packageBytes),
    await sha256(sceneBytes),
  );
}
