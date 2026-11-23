const digest = (value) =>
  typeof value === "string" && /^[a-f\d]{64}$/.test(value);
function exactKeys(value, keys) {
  if (
    !value ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw Error("Unexpected scene animation authority fields");
}
export function sceneAnimationFilePath(value) {
  if (
    typeof value !== "string" ||
    !/^[\w.@/-]+$/.test(value) ||
    value.startsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw Error("Canonical scene animation resource path required");
  return value;
}
function resource(value) {
  if (
    !value ||
    !digest(value.sha256) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1
  )
    throw Error("Digest-bound scene animation role resource required");
  sceneAnimationFilePath(value.file);
}
function unique(values, label) {
  if (new Set(values).size !== values.length)
    throw Error(`Duplicate scene animation ${label}`);
}
function graphIdentity(value, dependencies) {
  exactKeys(value, [
    "actor",
    "graph",
    "graphSha256",
    "catalog",
    "catalogSha256",
    "rig",
    "rigSha256",
    "leafIds",
  ]);
  sceneAnimationFilePath(value.actor);
  for (const [file, hash] of [
    ["graph", "graphSha256"],
    ["catalog", "catalogSha256"],
    ["rig", "rigSha256"],
  ]) {
    sceneAnimationFilePath(value[file]);
    if (
      !digest(value[hash]) ||
      !dependencies.some(
        (input) =>
          input.authority === "scene" &&
          input.file === value[file] &&
          input.sha256 === value[hash],
      )
    )
      throw Error(
        "Animation identity lacks its exact selected scene dependency",
      );
  }
  if (
    !Array.isArray(value.leafIds) ||
    !value.leafIds.length ||
    value.leafIds.some((id) => typeof id !== "string" || !id)
  )
    throw Error("Explicit original animation leaf identities required");
  unique(value.leafIds, "leaf identities");
}
function eventIdentity(value, dependencies) {
  exactKeys(value, [
    "graph",
    "graphSha256",
    "owner",
    "field",
    "nativeClass",
    "nativeField",
    "nativeOrder",
    "nativeMapEvidence",
    "schedulingAdmitted",
    "eventIds",
  ]);
  sceneAnimationFilePath(value.graph);
  if (
    !digest(value.graphSha256) ||
    !dependencies.some(
      (input) =>
        input.authority === "scene" &&
        input.file === value.graph &&
        input.sha256 === value.graphSha256,
    ) ||
    !Array.isArray(value.owner) ||
    value.owner.some(
      (item) =>
        !(
          (typeof item === "string" && item.length > 0) ||
          (Number.isSafeInteger(item) && item >= 0)
        ),
    ) ||
    !["mEventDataMap", "{f598463e}"].includes(value.field) ||
    typeof value.nativeClass !== "string" ||
    !value.nativeClass ||
    !(value.nativeField === null || value.nativeField === "f598463e") ||
    ![
      "unresolved-original-map",
      "see-bound-original-map-evidence",
      "source-declarations-only",
    ].includes(value.nativeOrder) ||
    value.schedulingAdmitted !== false ||
    !Array.isArray(value.eventIds) ||
    value.eventIds.some((id) => typeof id !== "string" || !id)
  )
    throw Error("Explicit original event map identity required");
  unique(value.eventIds, "event identities");
  if (value.nativeMapEvidence !== null) {
    exactKeys(value.nativeMapEvidence, ["file", "sha256"]);
    sceneAnimationFilePath(value.nativeMapEvidence.file);
    if (
      !digest(value.nativeMapEvidence.sha256) ||
      !dependencies.some(
        (input) =>
          input.authority === "scene" &&
          input.file === value.nativeMapEvidence.file &&
          input.sha256 === value.nativeMapEvidence.sha256,
      )
    )
      throw Error("Event map evidence is outside selected scene authority");
  }
}
// Mirrors tools/scene-animation-authority.schema.json. The original native
// profile/image stay separate; a scene cannot inherit another scene's roles.
export function validateSceneAnimationAuthority(value) {
  exactKeys(value, [
    "schema",
    "kind",
    "build",
    "protocol",
    "baseProfileSha256",
    "imageSha256",
    "sceneManifestSha256",
    "roles",
    "capabilities",
    "nativeSpectatorAdmitted",
  ]);
  if (
    value?.schema !== 1 ||
    value.kind !== "scene-animation-authority" ||
    typeof value.build !== "string" ||
    !value.build ||
    typeof value.protocol !== "string" ||
    !value.protocol ||
    ![
      value.baseProfileSha256,
      value.imageSha256,
      value.sceneManifestSha256,
    ].every(digest) ||
    value.nativeSpectatorAdmitted !== false ||
    value.capabilities?.dynamicStateProgram !== "unadmitted" ||
    ![
      "unsupported-matching-effects-required",
      "unsupported-native-event-classes",
    ].includes(value.capabilities.eventScheduling)
  )
    throw Error("Unsupported scene animation authority");
  const names = ["clock", "rig", "eventInventory", "leafPoses"];
  exactKeys(value.capabilities, ["dynamicStateProgram", "eventScheduling"]);
  if (!value.roles || Object.keys(value.roles).length !== names.length)
    throw Error("Exact scene animation roles required");
  for (const name of names) {
    const role = value.roles[name];
    exactKeys(role, ["file", "bytes", "sha256", "dependsOn", "identities"]);
    resource(role);
    if (
      !Array.isArray(role.dependsOn) ||
      !Array.isArray(role.identities) ||
      role.identities.some(
        (identity) =>
          !identity || typeof identity !== "object" || Array.isArray(identity),
      )
    )
      throw Error(
        "Explicit scene animation identities and dependencies required",
      );
    for (const dependency of role.dependsOn) {
      exactKeys(dependency, ["authority", "file", "bytes", "sha256"]);
      resource(dependency);
      if (!["scene", "native", "derived"].includes(dependency.authority))
        throw Error("Known animation dependency authority required");
    }
    unique(
      role.dependsOn.map((input) => `${input.authority}:${input.file}`),
      "dependencies",
    );
    if (name === "eventInventory") {
      for (const identity of role.identities)
        eventIdentity(identity, role.dependsOn);
      unique(
        role.identities.map((identity) =>
          JSON.stringify([identity.graph, identity.owner, identity.field]),
        ),
        "event maps",
      );
    } else {
      if (!role.identities.length)
        throw Error("At least one selected animation graph required");
      for (const identity of role.identities)
        graphIdentity(identity, role.dependsOn);
      unique(
        role.identities.map((identity) => identity.graph),
        "graphs",
      );
    }
  }
  unique(
    names.map((name) => value.roles[name].file),
    "role files",
  );
  const graphSet = (name) =>
    value.roles[name].identities
      .map((identity) =>
        JSON.stringify([
          identity.actor,
          identity.graph,
          identity.graphSha256,
          identity.catalog,
          identity.catalogSha256,
          identity.rig,
          identity.rigSha256,
          [...identity.leafIds].sort(),
        ]),
      )
      .sort()
      .join("\n");
  if (
    graphSet("clock") !== graphSet("rig") ||
    graphSet("clock") !== graphSet("leafPoses")
  )
    throw Error("Clock, rig and leaf pose graph identities differ");
  return value;
}

export function assertSceneAnimationAuthorityIdentity(value, expected) {
  validateSceneAnimationAuthority(value);
  for (const key of [
    "build",
    "protocol",
    "baseProfileSha256",
    "imageSha256",
    "sceneManifestSha256",
  ])
    if (value[key] !== expected[key])
      throw Error(`Scene animation authority identity differs: ${key}`);
  return value;
}
