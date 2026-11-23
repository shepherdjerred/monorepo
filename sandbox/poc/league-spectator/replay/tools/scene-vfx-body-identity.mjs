const digest = (value) =>
  typeof value === "string" && /^[a-f\d]{64}$/.test(value);
export function originalVfxBodyInputIdentity(entry) {
  if (
    !entry ||
    typeof entry.effectId !== "string" ||
    !entry.effectId.length ||
    !Number.isSafeInteger(entry.emitterIndex) ||
    entry.emitterIndex < 0 ||
    !["complex", "simple"].includes(entry.kind) ||
    !/^[a-f\d]{8}$/.test(entry.classHash) ||
    !/^[a-f\d]{8}$/.test(entry.ownerPathHash) ||
    !digest(entry.definitionSha256) ||
    !digest(entry.binSha256) ||
    !Array.isArray(entry.fields)
  )
    throw Error("Complete exact original VFX body input identity required");
  const fields = entry.fields.map((field) => {
    if (
      !/^[a-f\d]{8}$/.test(field.fieldHash) ||
      !Number.isSafeInteger(field.offset) ||
      field.offset < 0 ||
      !Number.isSafeInteger(field.bytes) ||
      field.bytes < 5 ||
      !digest(field.sha256)
    )
      throw Error("Exact ordered original VFX field span identity required");
    return {
      fieldHash: field.fieldHash,
      offset: field.offset,
      bytes: field.bytes,
      sha256: field.sha256,
    };
  });
  // Scene wrappers and file locations are not CPU inputs. Every authored byte,
  // original owner/class and payload annotation identity remains part of the key.
  return JSON.stringify({
    effectId: entry.effectId,
    emitterIndex: entry.emitterIndex,
    kind: entry.kind,
    classHash: entry.classHash,
    ownerPathHash: entry.ownerPathHash,
    definitionSha256: entry.definitionSha256,
    binSha256: entry.binSha256,
    fields,
  });
}

export function matchOriginalVfxBodies({ oldInputs, oldAuthority, newInputs }) {
  if (
    oldInputs.build !== newInputs.build ||
    oldInputs.protocol !== newInputs.protocol ||
    oldAuthority.build !== oldInputs.build ||
    oldAuthority.protocol !== oldInputs.protocol ||
    oldAuthority.nativeSpectatorAdmitted !== false ||
    oldAuthority.scope.completeInputInventory !== true ||
    oldAuthority.scope.fullPristineMathInitializer !== true ||
    oldAuthority.emitters.length !== oldInputs.emitters.length
  )
    throw Error("Matching complete original native body authority required");
  const byInput = new Map();
  for (const record of oldAuthority.emitters) {
    const input = oldInputs.emitters[record.inputIndex];
    if (
      !input ||
      record.effectId !== input.effectId ||
      record.emitterIndex !== input.emitterIndex ||
      record.sourceDefinitionSha256 !== input.definitionSha256 ||
      record.sourceBinSha256 !== input.binSha256 ||
      record.kind !== input.kind ||
      record.classHash !== input.classHash
    )
      throw Error("Original native body source/record identity differs");
    const identity = originalVfxBodyInputIdentity(input);
    if (byInput.has(identity))
      throw Error("Ambiguous original native body identity");
    byInput.set(identity, record);
  }
  const reused = [],
    missing = [];
  newInputs.emitters.forEach((input, inputIndex) => {
    const record = byInput.get(originalVfxBodyInputIdentity(input));
    if (record)
      reused.push({
        inputIndex,
        originalInputIndex: record.inputIndex,
        record,
      });
    else missing.push(inputIndex);
  });
  return { reused, missing };
}
