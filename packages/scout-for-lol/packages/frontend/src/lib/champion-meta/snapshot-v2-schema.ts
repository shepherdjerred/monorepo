import { z } from "zod";
import {
  MatchupFileSchema,
  MatchupSliceSchema,
  MetaContextSchema,
  MetaRoleSchema,
  MetaTierGradeSchema,
  RateSchema,
  type MetaRole,
} from "@scout-for-lol/data/meta/meta-serving.ts";
import { ChampionSliceSchema, championSlug, roleSlug } from "./snapshot.ts";

/**
 * The committed champion-meta snapshot, version 2: the same numbers as the
 * single-file snapshot, split so a static page loads exactly the file it needs.
 *
 * ```
 * champion-meta/index.json                                      every champion and role, with its headline
 * champion-meta/champions/<slug>.json                           one champion: slices and its opponents per role
 * champion-meta/matchups/<slug>/<role>/<opponent slug>.json     one matchup, from <slug>'s side
 * ```
 *
 * A matchup page (`/champions/<slug>/<role>/vs/<opponent>/`) reads its one
 * matchup file; a champion page its one champion file; the index page the
 * index. Every file names the build it was made from, the index names the
 * rank bracket, patch and queue, and every figure keeps the game count and
 * interval the meta API served. Lane figures carry their own game count, and
 * `source.lane` states the real window they cover.
 *
 * `meta/v1` consumers keep reading the single-file snapshot until the public
 * pages switch to this one.
 */

export const CHAMPION_META_SNAPSHOT_V2_VERSION = 2;

export const ChampionRefSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  slug: z.string().min(1),
});
export type ChampionRef = z.infer<typeof ChampionRefSchema>;

const OpponentEntrySchema = MatchupSliceSchema.shape.opponents.element;

/** One side's record in a matchup: games, wins, interval, spell pairs and lane. */
export const MatchupRecordSchema = OpponentEntrySchema.omit({
  championId: true,
  championName: true,
});
export type MatchupRecord = z.infer<typeof MatchupRecordSchema>;

export const SliceHeadlineSchema = z.object({
  games: z.number().int(),
  winRate: RateSchema,
  tier: MetaTierGradeSchema,
});
export type SliceHeadline = z.infer<typeof SliceHeadlineSchema>;

export const SnapshotSourceSchema = z.object({
  buildId: z.string(),
  generatedAt: z.iso.datetime(),
  firstDay: z.string(),
  lastDay: z.string(),
  minSliceGames: z.number().int(),
  minMatchupGames: z.number().int(),
  /** The ingest days with lane data; null when no retained day has any. */
  lane: z
    .object({
      firstDay: z.string(),
      lastDay: z.string(),
      days: z.number().int(),
    })
    .nullable(),
});

export const SnapshotIndexSchema = z.object({
  schemaVersion: z.literal(CHAMPION_META_SNAPSHOT_V2_VERSION),
  /** Where the numbers came from; null while the API has published nothing. */
  source: SnapshotSourceSchema.nullable(),
  /** The patch, queue and rank bracket every file was made at. */
  context: MetaContextSchema.nullable(),
  caveats: z.array(z.string()),
  champions: z.array(
    ChampionRefSchema.extend({
      roles: z
        .array(
          z.object({
            role: MetaRoleSchema,
            ...SliceHeadlineSchema.shape,
            pickRate: RateSchema,
            banRate: RateSchema,
            /** Listed opponents, one matchup file each. */
            opponents: z.number().int(),
          }),
        )
        .min(1),
    }),
  ),
});
export type SnapshotIndex = z.infer<typeof SnapshotIndexSchema>;

const ListedOpponentSchema = ChampionRefSchema.extend({
  games: z.number().int(),
  wins: z.number().int(),
  winRate: RateSchema,
  lane: OpponentEntrySchema.shape.lane,
});

export const SnapshotChampionSchema = ChampionRefSchema.extend({
  schemaVersion: z.literal(CHAMPION_META_SNAPSHOT_V2_VERSION),
  buildId: z.string(),
  context: MetaContextSchema,
  slices: z.array(ChampionSliceSchema).min(1),
  /** Every listed opponent per role, most played first. */
  matchups: z.array(
    z.object({
      role: MetaRoleSchema,
      opponents: z.array(ListedOpponentSchema),
    }),
  ),
});
export type SnapshotChampion = z.infer<typeof SnapshotChampionSchema>;

const MatchupSideSchema = ChampionRefSchema.extend({
  /** The champion's slice in this role, when it met the slice floor. */
  slice: SliceHeadlineSchema.nullable(),
});

export const SnapshotMatchupSchema = z.object({
  schemaVersion: z.literal(CHAMPION_META_SNAPSHOT_V2_VERSION),
  buildId: z.string(),
  context: MetaContextSchema.extend({ role: MetaRoleSchema }),
  champion: MatchupSideSchema.extend({ record: MatchupRecordSchema }),
  /** The opponent's own record in the same matchup; null when it is not listed from their side. */
  opponent: MatchupSideSchema.extend({
    record: MatchupRecordSchema.nullable(),
  }),
});
export type SnapshotMatchup = z.infer<typeof SnapshotMatchupSchema>;

/** The meta API's `matchups/:id` answer: every opponent of one champion, per role. */
export const MatchupsResponseSchema = MatchupFileSchema.extend({
  context: MetaContextSchema,
});
export type MatchupsResponse = z.infer<typeof MatchupsResponseSchema>;

export type SnapshotV2 = {
  index: SnapshotIndex;
  /** Keyed by file path, e.g. `champions/ahri.json`. */
  champions: Map<string, SnapshotChampion>;
  /** Keyed by file path, e.g. `matchups/ahri/middle/annie.json`. */
  matchups: Map<string, SnapshotMatchup>;
};

export const SNAPSHOT_V2_INDEX_PATH = "index.json";

export function championFile(slug: string): string {
  return `champions/${slug}.json`;
}

export function matchupFile(
  slug: string,
  role: MetaRole,
  opponentSlug: string,
): string {
  return `matchups/${slug}/${roleSlug(role)}/${opponentSlug}.json`;
}

/** A champion's file slug; a name with no slug is a broken contract. */
export function slugOf(name: string): string {
  const slug = championSlug(name);
  if (slug === "") throw new Error(`Champion name ${name} has no slug`);
  return slug;
}

export const EMPTY_SNAPSHOT_V2: SnapshotV2 = {
  index: {
    schemaVersion: CHAMPION_META_SNAPSHOT_V2_VERSION,
    source: null,
    context: null,
    caveats: [],
    champions: [],
  },
  champions: new Map(),
  matchups: new Map(),
};
