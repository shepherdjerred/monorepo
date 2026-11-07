import { test, expect } from "bun:test";
import { projectDirectEmitterControl as project } from "./direct-emitter-control-projection.mjs";
test("numeric projection retains the exact emitter and labels unresolved root dependencies", () => {
  const program = { source: { rate: { constantValue: 1 } } },
    compiled = {
      definitionHash: "a".repeat(64),
      emitters: [program],
      blockers: ["system:child-resource-ancestry"],
      unsupported: [],
      childResourceAncestryRequired: true,
      childSiblingProgram: {},
    };
  const projected = project(compiled, program);
  expect(projected.emitters[0]).toBe(program);
  expect(projected.childResourceAncestryRequired).toBe(false);
  expect(projected.childSiblingProgram).toBeNull();
  expect(projected.diagnosticRootProjection.originalRootBlockers).toEqual(
    compiled.blockers,
  );
  expect(projected.diagnosticRootProjection.matchResourceAdmission).toBe(false);
  expect(compiled.childResourceAncestryRequired).toBe(true);
  expect(() => project(compiled, structuredClone(program))).toThrow();
  for (const source of [
    { childParticleSetDefinition: null },
    { nested: [{ childParticleSetDefinition: {} }] },
  ]) {
    const child = { source };
    expect(() => project({ ...compiled, emitters: [child] }, child)).toThrow();
  }
});
