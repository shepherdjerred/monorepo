// Match-independent asset packages are joined to decoded events in the browser.
// A resolved definition is not evidence of particle activation or rendering.
export function bindLatestMissileEffects(report, manifest) {
  if (
    manifest.schema !== 1 ||
    manifest.build !== report.build ||
    manifest.protocol !== report.protocol
  )
    throw Error("Replay/effect package mismatch");
  const heroes = new Map(report.heroes.map((hero) => [hero.entityId, hero]));
  const records = report.missiles.map((record) => {
    const owner = heroes.get(record.cast.ownerId),
      base = {
        time: record.time,
        sequence: record.sequence,
        contextId: record.contextId,
        ownerId: record.cast.ownerId,
        spellHash: record.cast.spellHash,
        sourceName: record.cast.sourceName,
      };
    if (!owner) return { ...base, status: "unbound-owner" };
    if (
      record.cast.sourceName &&
      record.cast.sourceName.toLowerCase() !== owner.champion.toLowerCase()
    )
      return { ...base, status: "source-appearance-unprepared" };
    const key = `champions/${owner.champion.toLowerCase()}/${owner.skinId}`,
      actor = manifest.actors[key];
    if (
      !actor ||
      actor.character.toLowerCase() !== owner.champion.toLowerCase() ||
      actor.skinId !== owner.skinId
    )
      throw Error(`Effect package missing decoded appearance ${key}`);
    const binding = actor.missiles[record.cast.spellHash];
    if (!binding) return { ...base, actor: key, status: "spell-unprepared" };
    if (
      ![
        "prepared-definition",
        "no-declared-missile-effect-key",
        "unprepared-spell",
        "unprepared",
        "null-object-link",
      ].includes(binding.status)
    )
      throw Error(`Unknown effect binding status ${binding.status}`);
    if (binding.status !== "prepared-definition")
      return { ...base, actor: key, ...binding };
    const definition = manifest.definitions[binding.effectId];
    if (!definition || definition.actor !== key)
      throw Error("Effect definition belongs to a different appearance");
    return {
      ...base,
      actor: key,
      ...binding,
      definitionFile: definition.file,
      definitionSha256: definition.sha256,
      complexEmitters: definition.complexEmitters,
      simpleEmitters: definition.simpleEmitters,
    };
  });
  const counts = {};
  for (const record of records)
    counts[record.status] = (counts[record.status] ?? 0) + 1;
  return {
    records,
    summary: {
      records: records.length,
      statuses: counts,
      uniquePreparedEffects: new Set(
        records
          .filter((r) => r.status === "prepared-definition")
          .map((r) => r.effectId),
      ).size,
      renderedEffects: 0,
    },
  };
}
