import { actorObjectHash } from "./archived-actor-bin.mjs";

export function actorSpellHash(name) {
  let hash = 0;
  for (const character of name.toLowerCase()) {
    hash = ((hash << 4) + character.charCodeAt(0)) >>> 0;
    const high = hash & 0xf0000000;
    if (high) hash ^= high >>> 24;
    hash = (hash & ~high) >>> 0;
  }
  return hash;
}

export function buildActorSpellCatalog({
  actor,
  objects,
  attackNaming,
  attackNamingSha256,
}) {
  const spells = {},
    byName = new Map(),
    records = {};
  for (const [path, value] of objects) {
    if (value.__type !== "SpellObject" || !value.mSpell) continue;
    const name = value.ObjectName ?? value.mScriptName;
    if (typeof name !== "string" || !name.length)
      throw Error(`Unnamed original spell object ${path}`);
    const hash = actorSpellHash(name);
    const definition = {
      name,
      path,
      hash,
      animation: value.mSpell.mAnimationName ?? null,
      animationDefaultSource: "No absent animation-name default is inferred",
      data: value.mSpell,
    };
    if (
      spells[hash] &&
      JSON.stringify(spells[hash]) !== JSON.stringify(definition)
    )
      throw Error(`Conflicting archived spell identity ${name}`);
    spells[hash] = definition;
    byName.set(name.toLowerCase(), definition);
  }
  for (const path of actor.characterRecords) {
    const selected = objects.filter(
      ([key]) => actorObjectHash(key) === actorObjectHash(path),
    );
    if (selected.length !== 1 || selected[0][1].__type !== "CharacterRecord")
      throw Error(`Unresolved original character record ${path}`);
    const record = selected[0][1],
      attackSlots = {},
      unresolvedAttackSlots = {};
    for (let slot = 64; slot <= 81; slot++) {
      const source =
        slot === 64
          ? record.basicAttack
          : slot <= 72
            ? record.extraAttacks?.[slot - 65]
            : record.critAttacks?.[slot - 73];
      const format = attackNaming.defaults[slot];
      if (
        !format ||
        ![
          "%sBasicAttack",
          "%sBasicAttack%i",
          "%sCritAttack",
          "%sCritAttack%i",
        ].includes(format.format) ||
        (format.format.includes("%i") && !Number.isInteger(format.number))
      )
        throw Error("Original native attack-name formatter changed");
      if (
        typeof record.mCharacterName !== "string" ||
        !record.mCharacterName.length
      ) {
        unresolvedAttackSlots[slot] =
          "Original character-name namespace is absent";
        continue;
      }
      const implicit = format.format
        .replace("%s", record.mCharacterName)
        .replace("%i", String(format.number));
      const name = source?.mAttackName ?? implicit,
        definition = byName.get(name.toLowerCase());
      if (definition)
        attackSlots[slot] = {
          ...definition,
          attackData: source ?? null,
          implicitName: !source?.mAttackName,
        };
      else
        unresolvedAttackSlots[slot] =
          `Unresolved original attack spell ${name}`;
    }
    records[path] = { attackSlots, unresolvedAttackSlots, data: record };
  }
  return {
    schema: 2,
    character: actor.character,
    spells,
    records,
    dependencyCharacters: [],
    defaultAttackNaming: {
      sha256: attackNamingSha256,
      entryRva: attackNaming.entryRva,
      sourceSliceSha256: attackNaming.sliceSha256,
      recordNameField: "mCharacterName",
    },
    limitations: [
      "Only explicit original character records are included; runtime form/replacement selection remains separate",
      "Missing animation names and unresolved native attacks remain explicit",
      "This catalog does not prove spell activation, audio, particles or native presentation",
    ],
  };
}
