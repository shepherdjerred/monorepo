const uint = (n) => Number.isInteger(n) && n > 0 && n <= 0xffffffff;

// The first partial slice retains the original selected base resolver owner.
// A prepared definition alone does not establish that owner or its ancestry.
export function directChildSiblingResourceInputs(program, event, definitionId) {
  if (program == null) return { resolved: true, reasons: [], evidence: null };
  const s = event.resourceSelection,
    d = event.descriptor;
  const reasons = [];
  if (
    !d ||
    d.field8c !== 0 ||
    !uint(d.resourceKey) ||
    s?.status !== "matched-authored-reference" ||
    s.resourceKey !== d.resourceKey ||
    s.resource?.status !== "prepared-definition" ||
    s.resource.effectId !== definitionId ||
    s.referenceToken !== program.parentObjectPathHash
  )
    reasons.push("child:original-selected-parent-resource-unresolved");
  if (
    s?.stage?.kind !== "unit-base" ||
    !Number.isInteger(s.stage.unitIndex) ||
    s.stage.unitIndex < 0
  )
    reasons.push("child:selected-base-resolver-owner-unresolved");
  const fields = d
    ? ["resourceContextEntityId", "lookupA8EntityId"].filter((f) => d[f] !== 0)
    : [];
  const field = fields[s?.stage?.unitIndex];
  const units = s?.presentation?.units;
  const handles = new Map();
  for (const observation of Array.isArray(units) ? units : []) {
    if (observation.stack?.status !== "supplied-resource-stack") continue;
    for (const handle of [
      observation.stack.base,
      ...(observation.stack.overlays ?? []),
    ]) {
      if (handle == null) continue;
      if (
        handles.has(handle.id) &&
        handles.get(handle.id) !== handle.contextIdentity
      )
        reasons.push("child:conflicting-resolver-handle-context");
      handles.set(handle.id, handle.contextIdentity);
    }
  }
  const matches = Array.isArray(units)
    ? units.filter((u) => u.unitIndex === s?.stage?.unitIndex)
    : [];
  const unit = matches.length === 1 ? matches[0] : null;
  if (
    !field ||
    !uint(d?.[field]) ||
    !unit ||
    unit.field !== field ||
    unit.entityId !== d[field] ||
    unit.policy !== "native-initial-resource-presentation-prefix-v1" ||
    !uint(s?.identity) ||
    unit.contextIdentity !== s.identity ||
    !uint(unit.resolverDefinitionId) ||
    typeof unit.actorKey !== "string" ||
    !unit.actorKey.length ||
    unit.actorKey !== s.actorKey ||
    typeof s.handleId !== "string" ||
    !s.handleId.length ||
    unit.stack?.status !== "supplied-resource-stack" ||
    unit.stack.base?.id !== s.handleId ||
    unit.stack.base?.contextIdentity !== s.identity ||
    !Array.isArray(unit.stack.overlays) ||
    unit.stack.overlays.length !== 0 ||
    unit.browserStaticPackageReady !== true ||
    unit.nativeAcceptance !== null ||
    unit.nativeCacheReadiness !== null ||
    unit.liveEngineResourceState !== null ||
    s.presentation?.nativeAcceptance !== null ||
    s.presentation?.nativeCacheReadiness !== null ||
    s.presentation?.liveEngineResourceState !== null
  )
    reasons.push(
      "child:selected-resolver-context-and-handle-ancestry-unresolved",
    );
  return {
    resolved: reasons.length === 0,
    reasons,
    evidence: reasons.length
      ? null
      : {
          policy: "selected-base-resolver-child-sibling-presentation-v1",
          parentObjectPathHash: program.parentObjectPathHash,
          resourceKey: d.resourceKey,
          referenceToken: s.referenceToken,
          unitIndex: s.stage.unitIndex,
          field,
          entityId: unit.entityId,
          actorKey: unit.actorKey,
          contextIdentity: s.identity,
          resolverDefinitionId: unit.resolverDefinitionId,
          handleId: s.handleId,
          nativeAcceptance: null,
          nativeCacheReadiness: null,
          nativeResolverPointer: null,
        },
  };
}
