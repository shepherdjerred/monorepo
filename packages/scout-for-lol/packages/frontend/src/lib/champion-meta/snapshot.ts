import { z } from "zod";

/**
 * The committed champion-meta snapshot the static champion pages are built
 * from, and the schemas of the meta API responses it is refreshed from
 * (`GET /api/meta/v1/{manifest,champions/:id}`, served by the backend's
 * `http/meta-routes.ts`).
 *
 * The API schemas below name only the fields the pages show; unknown fields
 * are dropped on parse, so the API can add data without breaking the refresh.
 * The API already enforces its minimum samples: a slice, build or rune entry
 * that failed the floor is never returned, and nothing here re-derives or
 * relaxes that.
 */

export const CHAMPION_META_SNAPSHOT_VERSION = 1;

export const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

const BracketSchema = z.enum(["all", "low", "mid", "high", "master_plus"]);

const RateSchema = z.object({
  value: z.number(),
  lower: z.number(),
  upper: z.number(),
});

const ContextSchema = z.object({
  patch: z.string(),
  queueId: z.number().int(),
  queue: z.string(),
  bracket: BracketSchema,
});

const CountedSchema = z.object({
  games: z.number().int(),
  wins: z.number().int(),
  winRate: RateSchema,
  share: RateSchema,
});

export const ChampionSliceSchema = z.object({
  context: ContextSchema.extend({ role: RoleSchema }),
  sample: z.object({ games: z.number().int(), matches: z.number().int() }),
  winRate: RateSchema,
  pickRate: RateSchema,
  banRate: RateSchema,
  roleShare: RateSchema,
  tier: z.enum(["S", "A", "B", "C", "D"]),
  coreItems: z.array(CountedSchema.extend({ itemId: z.number().int() })),
  buildPaths: z.array(
    CountedSchema.extend({ itemIds: z.array(z.number().int()) }),
  ),
  startingItems: z.array(
    CountedSchema.extend({
      items: z.array(
        z.object({ itemId: z.number().int(), count: z.number().int() }),
      ),
    }),
  ),
  runes: z.array(
    CountedSchema.extend({
      primaryStyleId: z.number().int(),
      primaryPerkIds: z.array(z.number().int()),
      secondaryStyleId: z.number().int(),
      secondaryPerkIds: z.array(z.number().int()),
    }),
  ),
  spells: z.array(
    CountedSchema.extend({ spellIds: z.array(z.number().int()) }),
  ),
  skillOrders: z.array(CountedSchema.extend({ order: z.string() })),
});
export type ChampionSlice = z.infer<typeof ChampionSliceSchema>;

export const MetaManifestResponseSchema = z.object({
  buildId: z.string(),
  generatedAt: z.iso.datetime(),
  source: z.object({
    firstDay: z.string(),
    lastDay: z.string(),
    days: z.number().int(),
  }),
  thresholds: z.object({ minSliceGames: z.number().int() }),
  /** Null when nothing meets the sample floor. */
  defaults: ContextSchema.omit({ queue: true }).nullable(),
  champions: z.array(z.object({ id: z.number().int(), name: z.string() })),
  caveats: z.array(z.string()),
});

export const ChampionResponseSchema = z.object({
  buildId: z.string(),
  championId: z.number().int(),
  championName: z.string(),
  slices: z.array(ChampionSliceSchema),
});

/** Lowercase, ASCII, hyphenated: `Kai'Sa` is `kaisa`, `Nunu & Willump` is `nunu-willump`. */
export function championSlug(name: string): string {
  return name
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/['’.]/gu, "")
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
}

const ChampionEntrySchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  slug: z.string().min(1),
  slices: z.array(ChampionSliceSchema).min(1),
});
export type ChampionEntry = z.infer<typeof ChampionEntrySchema>;

export const ChampionMetaSnapshotSchema = z
  .object({
    schemaVersion: z.literal(CHAMPION_META_SNAPSHOT_VERSION),
    /** Where the numbers came from; null while the API has published nothing. */
    source: z
      .object({
        buildId: z.string(),
        generatedAt: z.iso.datetime(),
        firstDay: z.string(),
        lastDay: z.string(),
        minSliceGames: z.number().int(),
      })
      .nullable(),
    caveats: z.array(z.string()),
    champions: z.array(ChampionEntrySchema),
  })
  .superRefine((snapshot, context) => {
    const slugs = new Set<string>();
    for (const champion of snapshot.champions) {
      if (champion.slug !== championSlug(champion.name)) {
        context.addIssue({
          code: "custom",
          message: `Slug ${champion.slug} does not match ${champion.name}`,
        });
      }
      if (slugs.has(champion.slug)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate champion slug ${champion.slug}`,
        });
      }
      slugs.add(champion.slug);
    }
    if (snapshot.champions.length > 0 && snapshot.source === null) {
      context.addIssue({
        code: "custom",
        message: "A snapshot with champions must name its source",
      });
    }
  });
export type ChampionMetaSnapshot = z.infer<typeof ChampionMetaSnapshotSchema>;

export const EMPTY_CHAMPION_META_SNAPSHOT: ChampionMetaSnapshot = {
  schemaVersion: CHAMPION_META_SNAPSHOT_VERSION,
  source: null,
  caveats: [],
  champions: [],
};

export function parseChampionMetaSnapshot(raw: unknown): ChampionMetaSnapshot {
  return ChampionMetaSnapshotSchema.parse(raw);
}

export function hasChampions(snapshot: ChampionMetaSnapshot): boolean {
  return snapshot.champions.length > 0;
}

const ROLE_LABELS: Record<Role, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  UTILITY: "Support",
};

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

export function roleSlug(role: Role): string {
  return role.toLowerCase();
}

export function roleFromSlug(slug: string): Role | undefined {
  const parsed = RoleSchema.safeParse(slug.toUpperCase());
  return parsed.success ? parsed.data : undefined;
}

/** Roles a champion has a slice for, most played first. */
export function championRoles(champion: ChampionEntry): ChampionSlice[] {
  return champion.slices.toSorted(
    (left, right) =>
      right.sample.games - left.sample.games ||
      ROLES.indexOf(left.context.role) - ROLES.indexOf(right.context.role),
  );
}

const QUEUE_LABELS: Record<string, string> = {
  ranked_solo: "Ranked Solo/Duo",
  ranked_flex: "Ranked Flex",
  normal_draft: "Normal Draft",
};

const BRACKET_LABELS: Record<z.infer<typeof BracketSchema>, string> = {
  all: "all ranks",
  low: "Iron to Silver",
  mid: "Gold to Platinum",
  high: "Emerald to Diamond",
  master_plus: "Master and above",
};

/** "from 1,204 games · patch 16.3 · Ranked Solo/Duo · all ranks". */
export function evidenceLine(games: number, context: ChampionSlice["context"]) {
  const queue = QUEUE_LABELS[context.queue];
  if (queue === undefined) {
    throw new Error(`Unknown meta queue label ${context.queue}`);
  }
  return `from ${games.toLocaleString("en-US")} games · patch ${context.patch} · ${queue} · ${BRACKET_LABELS[context.bracket]}`;
}

export function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** The up-to-three builds the page shows side by side. */
export function topBuilds(slice: ChampionSlice): ChampionSlice["buildPaths"] {
  return slice.buildPaths.toSorted((a, b) => b.games - a.games).slice(0, 3);
}
