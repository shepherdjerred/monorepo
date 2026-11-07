import { validateDirectStaticMeshProgram } from "./latest-direct-effect-static-mesh-program.mjs";
import { validateDirectRayProgram } from "./latest-direct-effect-ray-program.mjs";
import { validateDirectRayMaterialSelection } from "./latest-direct-ray-material-package.mjs";

// The ordinary mesh transform consumes the same supplied system basis as its
// original 173c0b0/180a0a0 controls. This approves only the component consumer;
// entity, pose, provider, direction and lifecycle resolution remain separate.
export function directAttachmentComponentAdmitted(definition, emitter) {
  if (["camera-quad", "arbitrary-quad"].includes(emitter.primitive))
    return true;
  if (!["static-mesh", "ray"].includes(emitter.primitive)) return false;
  if (
    typeof definition.id !== "string" ||
    !/^[0-9a-f]{64}$/.test(definition.definitionHash)
  )
    throw Error(
      "Exact compiled primitive definition identity required for attachment",
    );
  if (emitter.primitive === "ray") {
    validateDirectRayProgram(emitter);
    validateDirectRayMaterialSelection(emitter, {
      id: definition.id,
      definitionHash: definition.definitionHash,
      index: emitter.index,
    });
    return true;
  }
  validateDirectStaticMeshProgram(emitter, {
    id: definition.id,
    definitionHash: definition.definitionHash,
    index: emitter.index,
  });
  return true;
}
