// Research-only candidate, before production integration. Fail on changed
// boundaries instead of silently comparing a different sampler implementation.
function once(source, before, after) {
  if (source.split(before).length !== 2)
    throw Error("Exact CPU ancestor candidate source boundary required");
  return source.replace(before, after);
}
export function cpuAncestorControlSource({ samplerSource, serviceSource }) {
  const integratedImport =
    'import { createLatestViewerCpuAncestorPose } from "./latest-viewer-cpu-ancestor-pose.mjs";';
  if (samplerSource.startsWith(integratedImport)) {
    // After integration the candidate is the real source. The control changes
    // only this private CPU opt-in; rendered/default/local paths stay identical.
    const baselineService = once(
      serviceSource,
      "        bindings: actor.bindings,\n        cpuAttachmentsOnly: true,\n      }),",
      "        bindings: actor.bindings,\n        cpuAttachmentsOnly: false,\n      }),",
    );
    return {
      sampler: samplerSource,
      service: serviceSource,
      baselineSampler: samplerSource,
      baselineService,
    };
  }
  let sampler =
    'import { createLatestViewerCpuAncestorPose } from "./latest-viewer-cpu-ancestor-pose.mjs";\n' +
    samplerSource;
  sampler = once(
    sampler,
    "  entityId,\n  bindings,\n}) {",
    "  entityId,\n  bindings,\n  cpuAttachmentsOnly = false,\n}) {",
  );
  sampler = once(
    sampler,
    "  function apply(layer) {",
    `  let cpuPose = null, cpuNames = null;
  function applyCpuPlan(plan, keys) {
    const names = [...new Set(keys.filter(key => key !== 0).map(key => keyMap.get(key).name))];
    if (!cpuNames || names.length !== cpuNames.length || names.some((name, index) => name !== cpuNames[index])) {
      cpuPose?.close();
      cpuPose = createLatestViewerCpuAncestorPose({ THREE, entry, attachmentNames: names });
      cpuNames = names;
    }
    cpuPose.apply(plan.layers);
  }
  function apply(layer) {`,
  );
  sampler = once(
    sampler,
    "      if (!rootOnly) applyPlan(plan);",
    "      if (!rootOnly) {\n        if (cpuAttachmentsOnly) applyCpuPlan(plan, attachmentKeys);\n        else applyPlan(plan);\n      }",
  );
  sampler = once(
    sampler,
    "        entry.group.updateWorldMatrix(true, true);",
    "        if (cpuAttachmentsOnly) cpuPose.updateWorldMatrices();\n        else entry.group.updateWorldMatrix(true, true);",
  );
  const service = once(
    serviceSource,
    "        bindings: actor.bindings,\n      }),",
    "        bindings: actor.bindings,\n        cpuAttachmentsOnly: true,\n      }),",
  );
  return {
    sampler,
    service,
    baselineSampler: samplerSource,
    baselineService: serviceSource,
  };
}
