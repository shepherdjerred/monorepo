// Explicit scene material authority. The approved build profile is immutable;
// these observations do not acquire resources or supply live scene predicates.
import { sha256 } from "./structural-comparison.mjs";
import { sameDirectCompiledData as same } from "./latest-direct-compiled-restore.mjs";
import { sceneAnimationFilePath } from "./scene-animation-authority.mjs";
import {
  SCENE_VFX_NATIVE_SOURCES,
  SCENE_VFX_MATERIAL_SOURCES,
  SCENE_VFX_INITIALIZER,
} from "./scene-vfx-material-contract.mjs";
import {
  validateSceneMaterialRows,
  sceneMaterialIdentity,
  describeSceneMaterial,
} from "./scene-vfx-material-data.mjs";

const decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  need = (value, message) => {
    if (!value) throw Error(message);
  };
const IMAGE =
    "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7",
  CLIENT = "0414ccc2ddfd3ba209c75d9c8f6ee6611ff1de11426afdf54007df12df219fab";
export async function createSceneVfxMaterialBindings({
  baseProfileBytes,
  imageBytes,
  sceneBytes,
  effectsManifestBytes,
  nativeAuthorityBytes,
  materialAuthorityBytes,
  readResource,
  signal,
}) {
  for (const bytes of [
    baseProfileBytes,
    imageBytes,
    sceneBytes,
    effectsManifestBytes,
    nativeAuthorityBytes,
    materialAuthorityBytes,
  ])
    need(
      bytes instanceof Uint8Array,
      "Owned scene material authority byte spans required",
    );
  need(
    typeof readResource === "function",
    "Explicit scene material resource reader required",
  );
  function active() {
    if (signal?.aborted)
      throw signal.reason ?? Error("Scene material binding aborted");
  }
  active();
  const profile = decode(baseProfileBytes),
    scene = decode(sceneBytes),
    effects = decode(effectsManifestBytes),
    native = decode(nativeAuthorityBytes),
    materials = decode(materialAuthorityBytes),
    profileSha = await sha256(baseProfileBytes),
    imageSha = await sha256(imageBytes),
    sceneSha = await sha256(sceneBytes),
    effectsSha = await sha256(effectsManifestBytes),
    nativeSha = await sha256(nativeAuthorityBytes),
    materialSha = await sha256(materialAuthorityBytes);
  need(
    profile.clientVersion === "16.21.829.8620" &&
      profile.protocolDigest === "20e09df23c66b85e" &&
      profile.decoderImageSha256 === IMAGE &&
      imageSha === IMAGE &&
      scene.kind === "archived-map11-common-runtime-scene" &&
      scene.map?.id === 11 &&
      effects.kind === "archived-map11-partial-effects" &&
      effects.sceneManifestSha256 === sceneSha,
    "Exact original Map11 scene/image/effect authority required",
  );
  for (const value of [native, materials])
    need(
      value.schema === 1 &&
        value.build === profile.clientVersion &&
        value.protocol === profile.protocolDigest &&
        value.sceneManifestSha256 === sceneSha &&
        value.effectsManifestSha256 === effectsSha &&
        value.nativeSpectatorAdmitted === false,
      "Scene material authority parents differ",
    );
  const composed =
    native.kind === "original-scene-vfx-composed-native-authority";
  need(
    composed || native.kind === "original-scene-vfx-native-authority",
    "Explicit original native body authority required",
  );
  need(
    materials.kind ===
      (composed
        ? "original-scene-vfx-composed-material-authority"
        : "original-scene-vfx-material-authority") &&
      materials.nativeAuthoritySha256 === nativeSha &&
      same(native.sources, SCENE_VFX_NATIVE_SOURCES) &&
      same(materials.sources, SCENE_VFX_MATERIAL_SOURCES) &&
      native.scope.completeInputInventory === true &&
      native.scope.fullPristineMathInitializer === true &&
      materials.scope.completeEligibleGraphInventory === true &&
      materials.scope.actualScenePredicates === false &&
      materials.scope.resourceAcquisition === false &&
      materials.scope.materialFactory === false &&
      materials.scope.shaderSubmission === false &&
      materials.scope.matchActivation === false,
    "Original scene material recipe/capability differs",
  );
  if (composed)
    for (const value of [native, materials])
      need(
        value.baseProfileSha256 === profileSha &&
          value.decoderImageSha256 === imageSha &&
          value.scope.historicalObservationLineageRetained === true,
        "Composed scene material original build identity differs",
      );
  need(
    same(native.initializer.range, [
      SCENE_VFX_INITIALIZER.start,
      SCENE_VFX_INITIALIZER.end,
    ]) && native.initializer.sourceSha256 === SCENE_VFX_INITIALIZER.sha256,
    "Complete pristine native initializer required",
  );
  need(
    (await sha256(
      imageBytes.subarray(
        SCENE_VFX_INITIALIZER.start,
        SCENE_VFX_INITIALIZER.end,
      ),
    )) === SCENE_VFX_INITIALIZER.sha256,
    "Original material initializer bytes differ",
  );
  const descriptors = new Map(),
    parents = { native: new Map(), material: new Map() },
    cache = new Map();
  for (const [authority, value] of [
    ["native", native],
    ["material", materials],
  ])
    for (const ref of value.files) {
      sceneAnimationFilePath(ref.file);
      const key = `${authority}:${ref.file}`;
      need(!descriptors.has(key), "Duplicate scene material resource");
      descriptors.set(key, ref);
    }
  async function read(authority, file) {
    active();
    sceneAnimationFilePath(file);
    const key = `${authority}:${file}`,
      ref = descriptors.get(key);
    need(ref, "Unselected scene material resource: " + key);
    const bytes = await readResource({ authority, file, signal });
    active();
    need(
      bytes instanceof Uint8Array &&
        bytes.length === ref.bytes &&
        (await sha256(bytes)) === ref.sha256,
      "Scene material resource integrity mismatch: " + key,
    );
    return bytes;
  }
  async function blocks(value) {
    need(
      Array.isArray(value.originalBlocks) && value.originalBlocks.length > 0,
      "Original material instruction blocks required",
    );
    for (const block of value.originalBlocks)
      need(
        Number.isSafeInteger(block.rva) &&
          Number.isSafeInteger(block.size) &&
          block.rva >= 0 &&
          block.size > 0 &&
          block.rva + block.size <= imageBytes.length &&
          (await sha256(
            imageBytes.subarray(block.rva, block.rva + block.size),
          )) === block.sha256,
        "Original material instruction identity differs",
      );
  }
  await blocks(native);
  for (const [authority, value] of [
    ["native", native],
    ["material", materials],
  ]) {
    if (composed)
      for (const ref of value.parents) {
        const bytes = await read(authority, ref.file),
          parent = decode(bytes);
        need(
          (await sha256(bytes)) === ref.sha256 &&
            parent.kind ===
              (authority === "native"
                ? "original-scene-vfx-native-authority"
                : "original-scene-vfx-material-authority") &&
            parent.build === value.build &&
            parent.protocol === value.protocol &&
            same(parent.sources, value.sources) &&
            parent.nativeSpectatorAdmitted === false,
          "Historical scene material parent identity differs",
        );
        parents[authority].set(ref.sha256, {
          meta: parent,
          prefix: ref.file.slice(0, -"manifest.json".length),
        });
      }
    else
      parents[authority].set(authority === "native" ? nativeSha : materialSha, {
        meta: value,
        prefix: "",
      });
  }
  const { rows, nativeRows } = validateSceneMaterialRows(materials, native),
    bound = new Set(),
    definitions = new Map();
  for (const row of native.emitters) {
    const ref = effects.definitions[row.effectId];
    need(
      ref && ref.sha256 === row.sourceDefinitionSha256,
      "Native material original definition absent from selected effects",
    );
  }
  async function bind(row) {
    const key = sceneMaterialIdentity(row);
    if (bound.has(key)) return;
    const body = nativeRows.get(`complex:${key}`),
      graph = decode(await read("native", body.resources.boundQuad.file));
    need(
      typeof graph.assetObjectHex === "string" &&
        /^(?:[a-f\d]{2})+$/.test(graph.assetObjectHex),
      "Exact complete native object bytes required",
    );
    const object = Uint8Array.from(graph.assetObjectHex.match(/../g), (value) =>
        parseInt(value, 16),
      ),
      view = new DataView(object.buffer);
    need(
      graph.effectId === row.effectId &&
        graph.emitterIndex === row.emitterIndex &&
        graph.sourceDefinitionSha256 === row.sourceDefinitionSha256 &&
        graph.primitiveKind === row.primitiveKind &&
        object.length === 0x470 &&
        graph.postloadGraphSha256 === body.resources.postload.sha256,
      "Native material complete source graph differs",
    );
    if (row.status === "original-material-selector-observed")
      need(
        view.getBigUint64(0x68, true) === 0n &&
          row.definedObjectMask ===
            [0x230, 0x48, 0x40].reduce(
              (mask, offset, bit) =>
                mask | (view.getBigUint64(offset, true) !== 0n ? 1 << bit : 0),
              0,
            ),
        "Native material original pointer predicates differ",
      );
    const bodyParent = parents.native.get(
      composed ? body.observation.authoritySha256 : nativeSha,
    );
    need(bodyParent, "Native body historical authority missing");
    const originalBody = bodyParent.meta.emitters.find(
      (original) =>
        original.inputIndex ===
        (composed ? body.observation.originalInputIndex : body.inputIndex),
    );
    need(
      originalBody &&
        originalBody.effectId === body.effectId &&
        originalBody.emitterIndex === body.emitterIndex &&
        originalBody.sourceBinSha256 === body.sourceBinSha256 &&
        originalBody.resources.boundQuad.sha256 === row.graphSha256,
      "Native body historical observation differs",
    );
    const part =
        originalBody.resources.boundQuad.file.split("/").slice(0, 2).join("/") +
        "/manifest.json",
      proofKey = `native:${bodyParent.prefix + part}`;
    let bodyProof = cache.get(proofKey);
    if (!bodyProof) {
      bodyProof = decode(await read("native", bodyParent.prefix + part));
      need(
        bodyProof.kind === "original-scene-vfx-native-worker" &&
          bodyProof.decoderImageSha256 === imageSha &&
          bodyProof.inputManifestSha256 ===
            bodyParent.meta.inputManifestSha256 &&
          same(bodyProof.sources, SCENE_VFX_NATIVE_SOURCES) &&
          Object.values(bodyProof.inputs).includes(profileSha) &&
          Object.values(bodyProof.inputs).includes(imageSha) &&
          Object.values(bodyProof.inputs).includes(CLIENT),
        "Native body worker original program/inputs differ",
      );
      await blocks(bodyProof);
      cache.set(proofKey, bodyProof);
    }
    need(
      bodyProof.emitters.some(
        (original) =>
          same(original, originalBody) ||
          same(
            {
              ...original,
              resources: Object.fromEntries(
                Object.entries(original.resources).map(([role, ref]) => [
                  role,
                  {
                    ...ref,
                    file: part.slice(0, -"manifest.json".length) + ref.file,
                  },
                ]),
              ),
            },
            originalBody,
          ),
      ),
      "Native body worker row differs from parent authority",
    );
    const materialParent = parents.material.get(
      composed ? row.observation.authoritySha256 : materialSha,
    );
    need(materialParent, "Material historical authority missing");
    const originalMaterial = materialParent.meta.emitters.find(
      (original) => sceneMaterialIdentity(original) === key,
    );
    need(
      originalMaterial &&
        originalMaterial.graphSha256 === row.graphSha256 &&
        originalMaterial.sourceDefinitionSha256 === row.sourceDefinitionSha256,
      "Historical material original graph differs",
    );
    const expanded = (record, catalog) => {
      const { observation, ...rest } = record;
      return {
        ...rest,
        graphFile: originalMaterial.graphFile,
        probes: record.probes?.map((probe) => ({
          input: probe.input,
          result: catalog[probe.result],
        })),
      };
    };
    need(
      same(
        expanded(row, materials.resultCatalog),
        expanded(originalMaterial, materialParent.meta.resultCatalog),
      ),
      "Composed material differs from historical selector observations",
    );
    const originalIndex = materialParent.meta.emitters.findIndex(
        (record) => sceneMaterialIdentity(record) === key,
      ),
      start = Math.floor(originalIndex / 100) * 100,
      child = materialParent.meta.children.find(
        (ref) => ref.file === `parts/${String(start).padStart(6, "0")}.json`,
      );
    need(child, "Material row has no bounded original worker receipt");
    const name = materialParent.prefix + child.file;
    let proof = cache.get(`material:${name}`);
    if (!proof) {
      proof = decode(await read("material", name));
      need(
        proof.kind === "original-scene-vfx-material-observations" &&
          proof.start === start &&
          proof.eligibleGraphs === materialParent.meta.emitters.length &&
          proof.decoderImageSha256 === imageSha &&
          proof.nativeAuthoritySha256 ===
            materialParent.meta.nativeAuthoritySha256 &&
          same(proof.runtime, materials.runtime) &&
          same(
            proof.sources,
            Object.fromEntries(
              Object.entries(SCENE_VFX_MATERIAL_SOURCES).filter(
                ([file]) => file !== "prepare-scene-vfx-materials.py",
              ),
            ),
          ) &&
          same(proof.initializer, {
            range: [SCENE_VFX_INITIALIZER.start, SCENE_VFX_INITIALIZER.end],
            sha256: SCENE_VFX_INITIALIZER.sha256,
          }),
        "Material worker original program/runtime differs",
      );
      await blocks(proof);
      cache.set(`material:${name}`, proof);
    }
    const observed = proof.emitters.find(
      (record) => sceneMaterialIdentity(record) === key,
    );
    need(
      observed &&
        same(
          expanded(observed, proof.resultCatalog),
          expanded(originalMaterial, materialParent.meta.resultCatalog),
        ),
      "Original material worker row differs from authority",
    );
    bound.add(key);
  }
  async function bindDefinitions(ids) {
    need(
      Array.isArray(ids) &&
        new Set(ids).size === ids.length &&
        ids.every(
          (id) =>
            typeof id === "string" && Object.hasOwn(effects.definitions, id),
        ),
      "Explicit unique selected material definitions required",
    );
    for (const id of ids) {
      if (!definitions.has(id)) definitions.set(id, []);
      for (const row of rows.values())
        if (row.effectId === id) {
          await bind(row);
          definitions.get(id).push(sceneMaterialIdentity(row));
        }
    }
  }
  return Object.freeze({
    async bindDefinitions(ids) {
      await bindDefinitions(ids);
    },
    async describe(effectId, emitterIndex, environment, dynamic) {
      const row = rows.get(`${effectId}:${emitterIndex}`);
      need(row, "Emitter has no prepared original material selector");
      await bind(row);
      return describeSceneMaterial(
        row,
        materials.resultCatalog,
        environment,
        dynamic,
        native.build,
      );
    },
    disposition(effectId, emitterIndex, kind = "complex") {
      const row = nativeRows.get(`${kind}:${effectId}:${emitterIndex}`);
      need(row, "Unknown original emitter identity");
      return structuredClone({
        status: row.status,
        reason: row.reason ?? null,
        materialStatus: rows.get(`${effectId}:${emitterIndex}`)?.status ?? null,
      });
    },
    describeAuthority() {
      return {
        build: native.build,
        protocol: native.protocol,
        sceneManifestSha256: sceneSha,
        effectsManifestSha256: effectsSha,
        nativeAuthoritySha256: nativeSha,
        materialAuthoritySha256: materialSha,
        sourceEmitters: native.emitters.length,
        eligibleQuads: rows.size,
        boundQuads: bound.size,
        scope: {
          actualScenePredicates: false,
          resourceAcquisition: false,
          shaderSubmission: false,
          nativeRendererAdmitted: false,
        },
      };
    },
  });
}
