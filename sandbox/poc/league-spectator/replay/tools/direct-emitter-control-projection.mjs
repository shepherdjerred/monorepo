// Numerical controls execute one unchanged compiled emitter. They do not execute
// the original parent, acquire child resources, or establish match activation.
// Keep that projection separate from production child ancestry admission.
const hasChildDeclaration = (value) =>
  value !== null &&
  typeof value === "object" &&
  (Object.hasOwn(value, "childParticleSetDefinition") ||
    Object.values(value).some(hasChildDeclaration));
export function projectDirectEmitterControl(compiled, program) {
  if (
    !compiled?.emitters?.includes(program) ||
    !program?.source ||
    hasChildDeclaration(program.source)
  )
    throw Error(
      "Numeric root projection requires an unchanged child-free compiled emitter",
    );
  return {
    ...compiled,
    blockers: [],
    unsupported: [],
    childResourceAncestryRequired: false,
    childSiblingProgram: null,
    emitters: [program],
    diagnosticRootProjection: {
      policy: "isolated-child-free-emitter-numeric-control-v1",
      originalDefinitionHash: compiled.definitionHash,
      originalRootBlockers: [...compiled.blockers],
      originalChildAncestryRequired:
        compiled.childResourceAncestryRequired === true,
      nativeParentActivation: false,
      matchResourceAdmission: false,
    },
  };
}
