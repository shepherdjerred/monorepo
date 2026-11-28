const sceneFields = new Set([
  "identity",
  "mapBounds",
  "meshBounds",
  "staticMesh",
  "assetDigests",
  "terrainMaterials",
  "structureModelBindings",
  "inhibitorModelBindings",
  "nexusModelBindings",
  "workerMotion",
  "navgrid",
  "minimap",
  "neutralObjectiveModelBindings",
  "laneMinionModelBindings",
  "championExperienceThresholds",
  "championInventoryItems",
  "followCameraDefaults",
]);

const motionFields = new Set([
  "waypointOrigin",
  "allowCurrentBuild",
  "decodeChampionStats",
  "decodeChampionInventory",
  "decodeChampionExperience",
  "championModelCatalog",
  "inhibitorCatalog",
  "turretCatalog",
  "nexusCatalog",
  "decodeNeutralCamps",
  "neutralCampSkins",
  "neutralObjectiveModels",
  "laneMinionCatalog",
  "decodePlayerState",
  "terrainControllerGraph",
  "decodeTeamVision",
  "championAnimationModelCatalog",
]);

function checkFields(value, allowed, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw Error(`The build-scoped ${label} must be an object.`);
  for (const key of Object.keys(value))
    if (!allowed.has(key))
      throw Error(`Unsupported build-scoped ${label} field: ${key}.`);
}

export function validateBuildScopedRiftScene(scene) {
  checkFields(scene, sceneFields, "scene");
  checkFields(scene.identity, new Set(["build", "protocol"]), "identity");
  checkFields(scene.workerMotion, motionFields, "motion");
  if (
    scene.identity.build !== "16.23.841.8428" ||
    scene.identity.protocol !== "8bbfcd5af2bc92db" ||
    scene.workerMotion.allowCurrentBuild !== true ||
    scene.workerMotion.championModelCatalog === undefined ||
    scene.workerMotion.turretCatalog === undefined ||
    scene.workerMotion.nexusCatalog === undefined
  )
    throw Error(
      "The build-scoped scene requires exact Rift world evidence and an archive champion catalog.",
    );
}
