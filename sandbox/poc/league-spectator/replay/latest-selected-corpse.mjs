import { sha256 } from "./structural-comparison.mjs";
import {
  assertDirectCompiledDataGraph,
  sameDirectCompiledData,
} from "./latest-direct-compiled-restore.mjs";
import { assertLatestStaticCatalogSelection } from "./latest-static-catalog.mjs";
import { CORPSE_POLICY_SHA } from "./latest-corpse-contract.mjs";
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

// Changing the champion lineup may change this parent, but not minion assets,
// authored lifetime data, original instructions, clocks or death-mode rules.
export function assertCorpseSceneRebinding(reference, selected, sceneSha256) {
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
    throw Error(
      "Selected corpse policy may rebind only its exact scene parent",
    );
}
export async function assertLatestSelectedCorpse({
  selection,
  profile,
  packageBytes,
  sceneBytes,
  worldBytes,
}) {
  assertLatestStaticCatalogSelection(selection);
  await selection.assertRole("corpsePolicy", packageBytes);
  await selection.assertRole("scene", sceneBytes);
  if (!sameDirectCompiledData(profile, selection.profile()))
    throw Error("Corpse profile differs from selected root");
  const referenceBytes = await selection.readRole("corpsePolicyReference");
  if ((await sha256(referenceBytes)) !== CORPSE_POLICY_SHA)
    throw Error("Fixed original corpse policy reference required");
  const scene = decode(sceneBytes),
    world = decode(worldBytes),
    reference = decode(referenceBytes);
  if (
    !Number.isInteger(scene.map?.id) ||
    scene.map.id !== world.mapId ||
    typeof scene.world !== "string" ||
    (await sha256(worldBytes)) !== reference.worldCatalogSha256 ||
    !sameDirectCompiledData(
      await selection.read(`latest-scene/${scene.world}`),
      worldBytes,
    )
  )
    throw Error(
      "Corpse world assets differ from original selected map resources",
    );
  assertCorpseSceneRebinding(
    reference,
    decode(packageBytes),
    await sha256(sceneBytes),
  );
  for (const asset of Object.values(reference.assets))
    if (
      (await sha256(await selection.read(`latest-scene/${asset.catalog}`))) !==
      asset.catalogSha256
    )
      throw Error(
        "Selected corpse authored character catalog differs from original approval",
      );
}
