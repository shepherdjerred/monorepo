import { isLatestDirectNavScene } from "./latest-direct-nav-scene.mjs";
import {
  DIRECT_NAV_SCENE_POLICY,
  DIRECT_NAV_SCENE_REQUIREMENTS,
} from "./latest-direct-nav-scene-contract.mjs";

const owners = new WeakSet();
export const isDirectNavSceneMaterialOwner = (v) =>
  v !== null && typeof v === "object" && owners.has(v);

// The renderer supplies the real GPU executor. This capability boundary does
// not turn a reported submission count into pixel evidence or effect coverage.
export function createDirectNavSceneMaterialOwner({ worldNavScene, execute }) {
  if (!isLatestDirectNavScene(worldNavScene) || typeof execute !== "function")
    throw Error(
      "Owned selected-scene navigation and renderer executor required",
    );
  const bindings = new WeakMap();
  let initialized = false,
    active = null,
    tail = Promise.resolve(),
    queued = 0;
  function finish(frameToken, frame, result) {
    if (
      !result ||
      typeof result.texture !== "object" ||
      result.texture === null ||
      result.width !== frame.metadata.width ||
      result.height !== frame.metadata.height ||
      result.format !== "bgra8-unorm" ||
      result.finishedPasses !== 5 ||
      result.frameSequence !== frame.sequence ||
      result.replayTime !== frame.replayTime ||
      result.sourcePackageSha256 !== frame.metadata.sourcePackageSha256 ||
      result.sourceInitialized !== true
    )
      throw Error(
        "Complete same-size renderer-owned five-pass navigation output required",
      );
    initialized = true;
    const binding = Object.freeze({});
    bindings.set(binding, { frameToken, frame, texture: result.texture });
    active = { frameToken, binding };
    return binding;
  }
  const owner = Object.freeze({
    renderSync(frameToken) {
      if (queued) throw Error("Navigation asynchronous submission is pending");
      const frame = worldNavScene.inspectFrame(frameToken);
      if (active?.frameToken === frameToken) return active.binding;
      active = null;
      const result = execute({
        initialization: initialized ? null : worldNavScene.initialization(),
        frame: structuredClone(frame),
      });
      if (result && typeof result.then === "function")
        throw Error("Synchronous timed navigation executor required");
      return finish(frameToken, frame, result);
    },
    render(frameToken) {
      // Validate ownership synchronously, before accepting a renderer job.
      const frame = worldNavScene.inspectFrame(frameToken);
      const run = async () => {
        if (active?.frameToken === frameToken) return active.binding;
        active = null;
        const result = await execute({
          initialization: initialized ? null : worldNavScene.initialization(),
          frame: structuredClone(frame),
        });
        return finish(frameToken, frame, result);
      };
      queued++;
      const result = tail.then(run).finally(() => {
        queued--;
      });
      tail = result.catch(() => {});
      return result;
    },
    inputs(binding, { replayTime, policy }) {
      const row = bindings.get(binding);
      if (!row || active?.binding !== binding)
        throw Error("Current renderer-owned navigation binding required");
      if (
        policy !== DIRECT_NAV_SCENE_POLICY ||
        replayTime !== row.frame.replayTime
      )
        throw Error(
          "Exact navigation presentation policy and replay time required",
        );
      return {
        uniforms: {
          [DIRECT_NAV_SCENE_REQUIREMENTS.uniform]:
            row.frame.transformBytes.slice(),
        },
        textures: {
          [DIRECT_NAV_SCENE_REQUIREMENTS.texture]: {
            kind: "renderer-owned-texture2d",
            dimension: "texture2d",
            texture: row.texture,
            width: row.frame.metadata.width,
            height: row.frame.metadata.height,
            inputPolicy: DIRECT_NAV_SCENE_POLICY,
            resourcePolicy: {
              sourcePackageSha256: row.frame.metadata.sourcePackageSha256,
              sceneManifestSha256: row.frame.metadata.sceneManifestSha256,
              navigationSourceSha256: row.frame.metadata.navigationSourceSha256,
              replayTime,
              sequence: row.frame.sequence,
            },
          },
        },
        omissions: [...row.frame.metadata.omissions],
        scope: {
          partialPresentationInputs: true,
          nativeSceneStateRecovered: false,
          pixelsVerifiedByThisContract: false,
          renderedEffectCoverage: false,
        },
      };
    },
  });
  owners.add(owner);
  return owner;
}

export function directNavSceneMaterialAdmission({
  requiredScene,
  owner,
  binding,
  replayTime,
  policy,
}) {
  if (
    !requiredScene ||
    !Array.isArray(requiredScene.blocks) ||
    !Array.isArray(requiredScene.textures)
  )
    throw Error("Explicit reflected navigation material requirements required");
  const textures = requiredScene.textures.filter(
      (t) => t.name === DIRECT_NAV_SCENE_REQUIREMENTS.texture,
    ),
    uniforms = requiredScene.blocks
      .flatMap((b) => b.requiredMembers ?? [])
      .filter((m) => m.name === DIRECT_NAV_SCENE_REQUIREMENTS.uniform);
  if (!textures.length && !uniforms.length)
    return { applicable: false, inputs: null, reasons: [] };
  if (
    textures.length !== 1 ||
    textures[0].dimension !== "texture2d" ||
    uniforms.length !== 1 ||
    uniforms[0].scalar !== "float" ||
    uniforms[0].size !== 16 ||
    uniforms[0].rows !== 1 ||
    uniforms[0].columns !== 4
  )
    throw Error(
      "Exact paired NAVMESH texture and NAV_GRID_XFORM reflection required",
    );
  if (!isDirectNavSceneMaterialOwner(owner))
    return {
      applicable: true,
      inputs: null,
      reasons: ["scene:nav-owned-world-resource-and-renderer-output"],
    };
  if (!binding)
    return {
      applicable: true,
      inputs: null,
      reasons: ["scene:nav-output-not-submitted-for-current-frame"],
    };
  return {
    applicable: true,
    inputs: owner.inputs(binding, { replayTime, policy }),
    reasons: [],
  };
}
