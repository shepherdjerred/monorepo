import { sha256 } from "./structural-comparison.mjs";
import { decodeRegisteredState } from "./latest-state-fields.mjs";
import { CHAMPION_STATE_SHA } from "./latest-champion-state.mjs";
export const COMBAT_STATS_SHA =
  "27faf667db3c20b02aea236e9288112d51ebd3d79a697d1108ed5929a394001b";
export const COMBAT_STAT_FIELDS = [
  "resourceRegenRate",
  "healthRegenRate",
  "moveSpeed",
  "attackRange",
  "armorPenetrationFlat",
  "physicalLethality",
  "armorPenetrationPercent",
  "bonusArmorPenetrationPercent",
  "magicPenetrationFlat",
  "magicLethality",
  "magicPenetrationPercent",
  "bonusMagicPenetrationPercent",
  "lifeSteal",
  "spellVamp",
  "omnivamp",
  "physicalVamp",
  "critDamage",
  "healShieldPower",
  "armor",
  "magicResist",
  "critChance",
  "attackDamage",
  "abilityPower",
  "abilityHaste",
];
export const PRIMARY_COMBAT_STATS = [
  "attackDamage",
  "abilityPower",
  "armor",
  "magicResist",
  "moveSpeed",
  "attackRange",
  "critChance",
  "abilityHaste",
];
const LABELS = {
  attackDamage: "Attack damage",
  abilityPower: "Ability power",
  armor: "Armor",
  magicResist: "Magic resist",
  moveSpeed: "Move speed",
  attackRange: "Attack range",
  critChance: "Crit chance",
  abilityHaste: "Ability haste",
  resourceRegenRate: "Resource regeneration",
  healthRegenRate: "Health regeneration",
  armorPenetrationFlat: "Flat armor penetration",
  physicalLethality: "Physical lethality",
  armorPenetrationPercent: "Armor pen scalar",
  bonusArmorPenetrationPercent: "Bonus armor pen scalar",
  magicPenetrationFlat: "Flat magic penetration",
  magicLethality: "Magic lethality",
  magicPenetrationPercent: "Magic pen scalar",
  bonusMagicPenetrationPercent: "Bonus magic pen scalar",
  lifeSteal: "Life steal scalar",
  spellVamp: "Spell vamp scalar",
  omnivamp: "Omnivamp scalar",
  physicalVamp: "Physical vamp scalar",
  critDamage: "Crit damage",
  healShieldPower: "Heal/shield power scalar",
};
const formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export function combatStatRows(values, primary = true) {
  const names = primary
    ? PRIMARY_COMBAT_STATS
    : COMBAT_STAT_FIELDS.filter((n) => !PRIMARY_COMBAT_STATS.includes(n));
  return names.map((name) => {
    const value = values[name] ?? null;
    if (value !== null && !Number.isFinite(value))
      throw Error("Invalid displayed combat stat");
    return {
      name,
      label: LABELS[name],
      value,
      formatted:
        value === null
          ? "Unavailable"
          : name === "critChance"
            ? `${formatter.format(value * 100)}%`
            : name === "critDamage"
              ? `${formatter.format(value)}%`
              : formatter.format(value),
    };
  });
}
const f = Math.fround;
export function deriveLatestCombatStats(input, meta) {
  const values = {};
  for (const [name, spec] of Object.entries(meta.stats)) {
    if (!spec.inputFields.every((key) => Object.hasOwn(input, key))) continue;
    const v = spec.inputFields.map((key) => {
      if (!Number.isFinite(input[key]))
        throw Error("Nonfinite combat stat input");
      return f(input[key]);
    });
    let result;
    if (spec.kind === "direct") result = v[0];
    else if (spec.kind === "scale") result = f(v[0] * spec.factor);
    else if (spec.kind === "attack-damage") {
      const [a, b, base, bonus, flat] = v,
        x = f(a + 1),
        y = f(b + 1),
        bonusPart = f(y * f(bonus * x)),
        basePart = f(x * base);
      result = f(f(base * flat) + f(basePart + bonusPart));
    } else if (spec.kind === "ability-power") {
      const [flat, pct, base] = v;
      result = f(f(base + flat) * f(pct + 1));
    } else if (spec.kind === "ability-haste") {
      const [base, mult] = v;
      result = f(f(mult * base) + base);
    } else throw Error("Unsupported native combat stat calculation");
    if (!Number.isFinite(result)) throw Error("Nonfinite derived combat stat");
    values[name] = result;
  }
  return values;
}
export async function createLatestCombatStatReader(
  profile,
  image,
  championBytes,
  bytes,
) {
  if (
    (await sha256(bytes)) !== COMBAT_STATS_SHA ||
    (await sha256(championBytes)) !== CHAMPION_STATE_SHA
  )
    throw Error("Pinned combat/champion stat packages required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-combat-stat-projections" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !== profile.sliceSha256 ||
    meta.championStatePackageSha256 !== CHAMPION_STATE_SHA ||
    Object.keys(meta.stats).length !== COMBAT_STAT_FIELDS.length ||
    !COMBAT_STAT_FIELDS.every((name) => Object.hasOwn(meta.stats, name))
  )
    throw Error("Unsupported combat stat package");
  for (const b of meta.sourceBlocks)
    if ((await sha256(image.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("Original combat stat code changed");
  return {
    metadata: structuredClone(meta),
    read: (record) => decodeRegisteredState(record, meta),
    reconstruct(records, heroIds, endTime) {
      const subjects = new Set(heroIds),
        inputs = new Map(),
        updates = [];
      for (const record of [...records].sort(
        (a, b) =>
          a.time - b.time ||
          a.transportSequence - b.transportSequence ||
          a.recordIndex - b.recordIndex,
      )) {
        if (!subjects.has(record.entityId)) continue;
        if (
          !Number.isFinite(record.time) ||
          record.time < 0 ||
          record.time > endTime ||
          !Number.isSafeInteger(record.transportSequence) ||
          !Number.isSafeInteger(record.recordIndex)
        )
          throw Error("Invalid combat stat record provenance");
        const decoded = decodeRegisteredState(record, meta),
          known = { ...(inputs.get(record.entityId) ?? {}), ...decoded.values };
        inputs.set(record.entityId, known);
        if (!Object.keys(decoded.values).length) continue;
        const all = deriveLatestCombatStats(known, meta),
          values = Object.fromEntries(
            Object.entries(all).filter(([name]) =>
              meta.stats[name].inputFields.some((key) =>
                Object.hasOwn(decoded.values, key),
              ),
            ),
          );
        if (!Object.keys(values).length) continue;
        updates.push({
          entityId: record.entityId,
          ...values,
          time: record.time,
          transportSequence: record.transportSequence,
          recordIndex: record.recordIndex,
          stateSequence: updates.length,
          chunkId: record.chunkId,
          blockOffset: record.blockOffset,
          stream: record.stream,
        });
      }
      return updates;
    },
  };
}
