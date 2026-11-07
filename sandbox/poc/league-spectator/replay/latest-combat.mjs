// Static spell references, never slot-to-animation guesses. Runtime overrides,
// full cast timing and attack-speed state remain explicit capability gaps.
export function resolveCombatPresentation(actor, catalog, report) {
  if (
    catalog.schema !== 2 ||
    catalog.character !== actor.character ||
    !Array.isArray(actor.characterRecords) ||
    !actor.characterRecords.length ||
    new Set(actor.characterRecords).size !== actor.characterRecords.length ||
    actor.characterRecords.some((path) => !catalog.records[path])
  )
    throw Error("Combat asset catalog mismatch");
  const actions = [],
    gaps = [],
    names = report.animations.filter((e) => e.entityId === actor.entityId);
  let explicitNameOverrides = 0;
  const add = (event, definition, sourceKind) => {
    if (
      typeof definition.animation !== "string" ||
      !definition.animation.length
    ) {
      gaps.push({ sourceKind, event, reason: "Empty asset animation name" });
      return;
    }
    if (names.some((name) => Math.abs(name.time - event.time) < 1e-9)) {
      explicitNameOverrides++;
      return;
    }
    actions.push({
      entityId: actor.entityId,
      time: event.time,
      sequence: event.sequence,
      name: definition.animation,
      rate: 1,
      sourceKind,
      definitionName: definition.name,
      recordVariants: definition.recordVariants ?? null,
      sourceEvent: event,
      timing:
        "Candidate: packet timestamp and unit clip rate; windup, attack speed and interruption unresolved",
    });
  };
  for (const event of report.attacks.filter(
    (e) => e.entityId === actor.entityId,
  )) {
    if (event.embeddedCastCount) {
      gaps.push({
        sourceKind: "attack",
        event,
        reason: "Embedded cast context not reconstructed",
      });
      continue;
    }
    const variants = actor.characterRecords.map((path) => ({
      path,
      definition: catalog.records[path].attackSlots[event.attackSlot],
    }));
    if (variants.some((variant) => !variant.definition)) {
      gaps.push({
        sourceKind: "attack",
        event,
        reason: `Unresolved attack slot ${event.attackSlot}: ${variants
          .filter((v) => !v.definition)
          .map((v) => v.path)
          .join(", ")}`,
      });
      continue;
    }
    const identities = new Set(
      variants.map((v) =>
        JSON.stringify([
          v.definition.name,
          v.definition.hash,
          v.definition.animation,
        ]),
      ),
    );
    if (identities.size !== 1) {
      gaps.push({
        sourceKind: "attack",
        event,
        reason: `Attack slot ${event.attackSlot} has mode-dependent spell/animation identities`,
        recordVariants: variants.map((v) => ({
          path: v.path,
          spellName: v.definition.name,
          spellHash: v.definition.hash,
          animation: v.definition.animation,
        })),
      });
      continue;
    }
    const { name, hash, animation } = variants[0].definition;
    add(
      event,
      {
        name,
        hash,
        animation,
        recordVariants: variants.map((v) => ({
          path: v.path,
          attackData: v.definition.attackData,
        })),
      },
      "attack",
    );
  }
  for (const event of report.casts.filter(
    (e) => e.entityId === actor.entityId,
  )) {
    if (
      event.sourceName &&
      event.sourceName.toLowerCase() !== actor.character.toLowerCase()
    ) {
      gaps.push({
        sourceKind: "cast",
        event,
        reason: `Unprepared source character ${event.sourceName}`,
      });
      continue;
    }
    const definition = catalog.spells[event.spellHash];
    if (!definition) {
      gaps.push({
        sourceKind: "cast",
        event,
        reason: `Unresolved spell hash ${event.spellHash}`,
      });
      continue;
    }
    add(event, definition, "cast");
  }
  return {
    actions: actions.sort((a, b) => a.time - b.time || a.sequence - b.sequence),
    gaps,
    explicitNameOverrides,
  };
}
