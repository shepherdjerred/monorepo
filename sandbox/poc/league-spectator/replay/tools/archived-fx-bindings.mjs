import { actorObjectHash } from "./archived-actor-bin.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";

export function archivedFxField(value, name) {
  return Object.hasOwn(value, name)
    ? value[name]
    : value[`{${actorObjectHash(name)}}`];
}

// No source ordering policy: identical definitions can share a value, while
// differing candidates remain unsupported until a native precedence proof.
export function createArchivedFxObjectIndex(bins) {
  const index = new Map();
  for (const bin of bins)
    for (const [path, value] of Object.entries(bin.normalized)) {
      const id = actorObjectHash(path),
        rows = index.get(id) ?? [];
      rows.push({
        file: bin.file,
        wad: bin.wad,
        sourceSha256: bin.sourceSha256,
        value,
      });
      index.set(id, rows);
    }
  return {
    has: (id) => index.has(actorObjectHash(id)),
    select(reference) {
      const id = actorObjectHash(reference),
        rows = index.get(id);
      if (!rows?.length)
        return { status: "missing-original-object", id, candidates: [] };
      const candidates = rows.map(({ value: _, ...source }) => source);
      if (new Set(rows.map((row) => stringifyAssetJson(row.value))).size !== 1)
        return {
          status: "unsupported-original-object-precedence",
          id,
          candidates,
        };
      return {
        status: "exact-original-object",
        id,
        value: structuredClone(rows[0].value),
        candidates,
      };
    },
  };
}

export function compileArchivedFxActor({ character, skinId, index, spells }) {
  const unresolved = [],
    resources = {},
    missiles = {},
    reference = `Characters/${character}/Skins/Skin${skinId}`,
    skin = index.select(reference);
  function selected(id, reason) {
    const result = index.select(id);
    if (result.status !== "exact-original-object") {
      unresolved.push({ reference: id, reason, ...result });
      return null;
    }
    return result;
  }
  if (skin.status !== "exact-original-object")
    throw Error(`Selected archived skin is unresolved: ${reference}`);
  const resolverId = archivedFxField(skin.value, "mResourceResolver"),
    resolver =
      resolverId && actorObjectHash(resolverId) !== "00000000"
        ? selected(resolverId, "skin resource resolver")
        : null,
    map = resolver ? archivedFxField(resolver.value, "resourceMap") : null;
  if (map?.__type === "UnresolvedOriginalBinMap")
    unresolved.push({
      reference: resolverId,
      reason: "unsupported-original-resource-map",
      declaration: structuredClone(map),
    });
  else if (map)
    for (const [alias, target] of Object.entries(map)) {
      const key = actorObjectHash(alias);
      if (actorObjectHash(target) === "00000000") {
        resources[key] = { status: "null-object-link", reference: target };
        continue;
      }
      const object = selected(target, `resource ${key}`);
      resources[key] =
        object &&
        actorObjectHash(object.value.__type) ===
          actorObjectHash("VfxSystemDefinitionData")
          ? {
              status: "prepared-definition",
              reference: target,
              definitionId: object.id,
            }
          : {
              status: "unprepared",
              reference: target,
              reason: object
                ? `Original resource class ${object.value.__type}`
                : "Original definition unresolved",
            };
    }
  for (const spell of Object.values(spells)) {
    const object = selected(spell.path, `spell ${spell.name}`);
    if (!object) {
      missiles[spell.hash] = { spell: spell.name, status: "unprepared-spell" };
      continue;
    }
    const data = archivedFxField(object.value, "mSpell");
    if (!data) throw Error(`Original spell has no data: ${spell.path}`);
    const effectKey = archivedFxField(data, "mMissileEffectKey") ?? null,
      actual = effectKey === null ? "00000000" : actorObjectHash(effectKey),
      expected =
        spell.data.mMissileEffectKey == null
          ? "00000000"
          : actorObjectHash(spell.data.mMissileEffectKey);
    if (actual !== expected)
      throw Error(
        `Selected spell catalog differs from archived FX source: ${spell.path}`,
      );
    missiles[spell.hash] =
      actual === "00000000"
        ? { spell: spell.name, status: "no-declared-missile-effect-key" }
        : {
            spell: spell.name,
            effectKey,
            ...(resources[actual] ?? {
              status: "unprepared",
              reason: "Effect key absent from selected skin resolver",
            }),
          };
  }
  return {
    character,
    skinId,
    resourceResolverId: resolverId ?? null,
    resources,
    missiles,
    unresolved,
  };
}
