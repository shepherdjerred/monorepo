// Select current compiled component identities from passing native comparisons.
// Visual sample availability never determines simulation coverage.
export function selectNativeComparedInventory(admission, proofs) {
  if (
    !Array.isArray(admission?.definitions) ||
    !Array.isArray(proofs) ||
    !proofs.length
  )
    throw Error("Current admission and native comparisons required");
  const compared = new Map(),
    proofNames = new Set();
  for (const { name, report } of proofs) {
    if (
      typeof name !== "string" ||
      !name.length ||
      proofNames.has(name) ||
      !Array.isArray(report?.mismatches) ||
      report.mismatches.length ||
      !Array.isArray(report.cases) ||
      !report.cases.length
    )
      throw Error("Unique passing native comparison required");
    proofNames.add(name);
    for (const row of report.cases) {
      if (
        typeof row.effectId !== "string" ||
        !row.effectId.length ||
        !Number.isSafeInteger(row.emitterIndex) ||
        row.emitterIndex < 0 ||
        !Number.isSafeInteger(row.frames) ||
        row.frames < 1 ||
        row.mismatches !== 0
      )
        throw Error("Native comparison case has no verified component frames");
      const key = `${row.effectId}:${row.emitterIndex}`;
      const names = compared.get(key) ?? new Set();
      names.add(name);
      compared.set(key, names);
    }
  }
  const inventory = [],
    admitted = new Set(),
    definitions = new Set();
  for (const definition of admission.definitions) {
    if (
      typeof definition.id !== "string" ||
      !definition.id.length ||
      definitions.has(definition.id) ||
      !Array.isArray(definition.supported)
    )
      throw Error("Unique admitted definition identities required");
    definitions.add(definition.id);
    for (const emitterIndex of definition.supported) {
      const shaderKey = `${definition.id}:${emitterIndex}`;
      if (
        !Number.isSafeInteger(emitterIndex) ||
        emitterIndex < 0 ||
        admitted.has(shaderKey)
      )
        throw Error("Unique admitted emitter identities required");
      admitted.add(shaderKey);
      const coverage = compared.get(shaderKey);
      if (!coverage)
        throw Error(`Admitted component lacks native comparison: ${shaderKey}`);
      inventory.push({
        effectId: definition.id,
        emitterIndex,
        shaderKey,
        nativeProofs: [...coverage].sort(),
      });
    }
  }
  if (!inventory.length)
    throw Error("Admitted native-compared inventory is empty");
  return {
    components: inventory.sort((a, b) =>
      a.shaderKey.localeCompare(b.shaderKey),
    ),
    extraNativeComponentKeys: [...compared.keys()]
      .filter((key) => !admitted.has(key))
      .sort(),
  };
}
