import {
  getRuneTreeForRune,
  MatchLoadoutSchema,
  MatchRunePageSchema,
  type MatchLoadout,
  type MatchRunePage,
  type RawParticipant,
} from "@scout-for-lol/data";
import { ITEM_SLOT_COLUMNS } from "@scout-for-lol/data/model/reports/lake-columns.ts";
import { MATCH_REBUILD_GATED_COLUMNS } from "@scout-for-lol/data/model/reports/match-rebuild-gated-columns.ts";
import { z } from "zod";

/** UI reads name their rebuilt fields without also selecting newer ScoutQL columns. */
export const MATCH_UI_READ_COLUMNS = [
  ...ITEM_SLOT_COLUMNS,
  ...MATCH_REBUILD_GATED_COLUMNS,
] as const;

const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

export const MatchLoadoutLakeRowSchema = z.object({
  item0: LakeIntSchema,
  item1: LakeIntSchema,
  item2: LakeIntSchema,
  item3: LakeIntSchema,
  item4: LakeIntSchema,
  item5: LakeIntSchema,
  item6: LakeIntSchema,
  summoner_spell_1_id: LakeIntSchema,
  summoner_spell_2_id: LakeIntSchema,
  primary_rune_style_id: LakeIntSchema.nullable(),
  primary_rune_0_id: LakeIntSchema.nullable(),
  primary_rune_1_id: LakeIntSchema.nullable(),
  primary_rune_2_id: LakeIntSchema.nullable(),
  primary_rune_3_id: LakeIntSchema.nullable(),
  secondary_rune_style_id: LakeIntSchema.nullable(),
  secondary_rune_0_id: LakeIntSchema.nullable(),
  secondary_rune_1_id: LakeIntSchema.nullable(),
  stat_perk_offense_id: LakeIntSchema.nullable(),
  stat_perk_flex_id: LakeIntSchema.nullable(),
  stat_perk_defense_id: LakeIntSchema.nullable(),
});

export type MatchLoadoutLakeRow = z.infer<typeof MatchLoadoutLakeRowSchema>;

type MatchLoadoutLakeFields = Omit<
  MatchLoadoutLakeRow,
  "item0" | "item1" | "item2" | "item3" | "item4" | "item5" | "item6"
>;

export const MATCH_LOADOUT_LAKE_COLUMNS_SQL =
  "item0, item1, item2, item3, item4, item5, item6, " +
  "summoner_spell_1_id, summoner_spell_2_id, primary_rune_style_id, " +
  "primary_rune_0_id, primary_rune_1_id, primary_rune_2_id, primary_rune_3_id, " +
  "secondary_rune_style_id, secondary_rune_0_id, secondary_rune_1_id, " +
  "stat_perk_offense_id, stat_perk_flex_id, stat_perk_defense_id";

function runeStyleId(
  style: RawParticipant["perks"]["styles"][number],
  participantId: number,
): number {
  if (style.style !== 0) return style.style;

  // Riot sometimes sends style 0 alongside real rune selections. Infer the
  // missing tree only when every selected rune identifies the same tree.
  const trees = style.selections.map(
    (selection) => getRuneTreeForRune(selection.perk)?.treeId,
  );
  const [firstTree] = trees;
  if (firstTree === undefined || trees.some((tree) => tree !== firstTree)) {
    throw new Error(
      `Participant ${participantId.toString()} has a missing ${style.description} rune style with inconsistent selections`,
    );
  }
  return firstTree;
}

function runePageFromParticipant(
  participant: RawParticipant,
): MatchRunePage | null {
  const primary = participant.perks.styles.find(
    (style) => style.description === "primaryStyle",
  );
  const secondary = participant.perks.styles.find(
    (style) => style.description === "subStyle",
  );
  const rawValues = [
    ...participant.perks.styles.flatMap((style) => [
      style.style,
      ...style.selections.map((selection) => selection.perk),
    ]),
    ...(participant.perks.statPerks === undefined
      ? []
      : [
          participant.perks.statPerks.offense,
          participant.perks.statPerks.flex,
          participant.perks.statPerks.defense,
        ]),
  ];
  if (rawValues.every((value) => value === 0)) return null;
  if (
    primary === undefined ||
    secondary === undefined ||
    participant.perks.styles.length !== 2 ||
    primary.selections.length !== 4 ||
    secondary.selections.length !== 2
  ) {
    throw new Error(
      `Participant ${participant.participantId.toString()} has a malformed rune page`,
    );
  }
  return MatchRunePageSchema.parse({
    primaryStyleId: runeStyleId(primary, participant.participantId),
    primaryRuneIds: primary.selections.map((selection) => selection.perk),
    secondaryStyleId: runeStyleId(secondary, participant.participantId),
    secondaryRuneIds: secondary.selections.map((selection) => selection.perk),
    // A Scout Client match has no stat shards to state.
    statShardIds: participant.perks.statPerks ?? null,
  });
}

function runeTreeToLakeColumns(
  runes: MatchRunePage | null | undefined,
): Pick<
  MatchLoadoutLakeFields,
  | "primary_rune_style_id"
  | "primary_rune_0_id"
  | "primary_rune_1_id"
  | "primary_rune_2_id"
  | "primary_rune_3_id"
  | "secondary_rune_style_id"
  | "secondary_rune_0_id"
  | "secondary_rune_1_id"
> {
  const primaryRuneIds = runes?.primaryRuneIds ?? [];
  const secondaryRuneIds = runes?.secondaryRuneIds ?? [];
  return {
    primary_rune_style_id: runes?.primaryStyleId ?? null,
    primary_rune_0_id: primaryRuneIds[0] ?? null,
    primary_rune_1_id: primaryRuneIds[1] ?? null,
    primary_rune_2_id: primaryRuneIds[2] ?? null,
    primary_rune_3_id: primaryRuneIds[3] ?? null,
    secondary_rune_style_id: runes?.secondaryStyleId ?? null,
    secondary_rune_0_id: secondaryRuneIds[0] ?? null,
    secondary_rune_1_id: secondaryRuneIds[1] ?? null,
  };
}

function runeShardsToLakeColumns(
  runes: MatchRunePage | null | undefined,
): Pick<
  MatchLoadoutLakeFields,
  "stat_perk_offense_id" | "stat_perk_flex_id" | "stat_perk_defense_id"
> {
  const statShardIds = runes?.statShardIds;
  return {
    stat_perk_offense_id: statShardIds?.offense ?? null,
    stat_perk_flex_id: statShardIds?.flex ?? null,
    stat_perk_defense_id: statShardIds?.defense ?? null,
  };
}

function runePageToLakeColumns(
  runes: MatchRunePage | null | undefined,
): Pick<
  MatchLoadoutLakeFields,
  | "primary_rune_style_id"
  | "primary_rune_0_id"
  | "primary_rune_1_id"
  | "primary_rune_2_id"
  | "primary_rune_3_id"
  | "secondary_rune_style_id"
  | "secondary_rune_0_id"
  | "secondary_rune_1_id"
  | "stat_perk_offense_id"
  | "stat_perk_flex_id"
  | "stat_perk_defense_id"
> {
  return {
    ...runeTreeToLakeColumns(runes),
    ...runeShardsToLakeColumns(runes),
  };
}

function loadoutToLakeFields(loadout: MatchLoadout): MatchLoadoutLakeFields {
  return {
    summoner_spell_1_id: loadout.summonerSpellIds[0],
    summoner_spell_2_id: loadout.summonerSpellIds[1],
    ...runePageToLakeColumns(loadout.runes),
  };
}

export function matchLoadoutLakeFields(
  loadout: MatchLoadout,
): MatchLoadoutLakeFields {
  return loadoutToLakeFields(loadout);
}

export function participantLoadoutLakeRow(
  participant: RawParticipant,
): MatchLoadoutLakeFields {
  return loadoutToLakeFields({
    itemIds: [
      participant.item0,
      participant.item1,
      participant.item2,
      participant.item3,
      participant.item4,
      participant.item5,
      participant.item6,
    ],
    summonerSpellIds: [participant.summoner1Id, participant.summoner2Id],
    runes: runePageFromParticipant(participant),
  });
}

export function matchLoadoutFromLakeRow(
  row: MatchLoadoutLakeRow,
): MatchLoadout {
  const runeValues = [
    row.primary_rune_style_id,
    row.primary_rune_0_id,
    row.primary_rune_1_id,
    row.primary_rune_2_id,
    row.primary_rune_3_id,
    row.secondary_rune_style_id,
    row.secondary_rune_0_id,
    row.secondary_rune_1_id,
    row.stat_perk_offense_id,
    row.stat_perk_flex_id,
    row.stat_perk_defense_id,
  ];
  const runes = runeValues.every((value) => value === null)
    ? null
    : {
        primaryStyleId: row.primary_rune_style_id,
        primaryRuneIds: [
          row.primary_rune_0_id,
          row.primary_rune_1_id,
          row.primary_rune_2_id,
          row.primary_rune_3_id,
        ],
        secondaryStyleId: row.secondary_rune_style_id,
        secondaryRuneIds: [row.secondary_rune_0_id, row.secondary_rune_1_id],
        statShardIds:
          row.stat_perk_offense_id === null &&
          row.stat_perk_flex_id === null &&
          row.stat_perk_defense_id === null
            ? null
            : {
                offense: row.stat_perk_offense_id,
                flex: row.stat_perk_flex_id,
                defense: row.stat_perk_defense_id,
              },
      };
  return MatchLoadoutSchema.parse({
    itemIds: [
      row.item0,
      row.item1,
      row.item2,
      row.item3,
      row.item4,
      row.item5,
      row.item6,
    ],
    summonerSpellIds: [row.summoner_spell_1_id, row.summoner_spell_2_id],
    runes,
  });
}
