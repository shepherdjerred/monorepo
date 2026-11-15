import type { MetaReader } from "#src/meta/meta-reader.ts";
import {
  META_QUEUE_LABELS,
  MetaBracketSchema,
  MetaRoleSchema,
  type ChampionSlice,
  type MatchupFile,
  type MetaBracket,
  type MetaContext,
  type MetaManifest,
  type MetaRole,
  type TierFile,
} from "#src/meta/meta-serving.ts";

/**
 * The reads behind the public meta API and the Explore meta tools: choosing a
 * (patch, queue, bracket) slice and returning what the serving JSON holds for
 * it. Both surfaces map these results to their own transport, so a champion
 * the API calls unknown is unknown to Explore too.
 */

export type MetaSelection = {
  patch?: string | undefined;
  queueId?: number | undefined;
  bracket?: MetaBracket | undefined;
  role?: MetaRole | undefined;
};

export type MetaErrorCode =
  | "meta_unavailable"
  | "unknown_champion"
  | "invalid_selection"
  | "slice_not_found"
  | "matchup_not_found";

export type MetaFailure = { ok: false; code: MetaErrorCode; message: string };
export type MetaSuccess<T> = { ok: true; value: T };
export type MetaResult<T> = MetaSuccess<T> | MetaFailure;

function failure(code: MetaErrorCode, message: string): MetaFailure {
  return { ok: false, code, message };
}

const PATCH_PATTERN = /^\d+\.\d+$/u;

function present(text: string | null | undefined): string | undefined {
  return text === null || text === undefined || text === "" ? undefined : text;
}

function invalid(message: string): MetaFailure {
  return failure("invalid_selection", message);
}

function parseQueue(text: string): MetaResult<number> {
  const byLabel = Object.entries(META_QUEUE_LABELS).find(
    ([, label]) => label === text,
  );
  const queueId = Number(byLabel === undefined ? text : byLabel[0]);
  if (Number.isInteger(queueId) && META_QUEUE_LABELS[queueId] !== undefined) {
    return { ok: true, value: queueId };
  }
  const known = Object.entries(META_QUEUE_LABELS)
    .map(([id, label]) => `${id} (${label})`)
    .join(", ");
  return invalid(`Queue must be one of ${known}: ${text}`);
}

function parsePatch(text: string): MetaResult<string> {
  return PATCH_PATTERN.test(text)
    ? { ok: true, value: text }
    : invalid(`Patch must look like 15.10: ${text}`);
}

function parseBracket(text: string): MetaResult<MetaBracket> {
  const parsed = MetaBracketSchema.safeParse(text);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : invalid(
        `Bracket must be one of ${MetaBracketSchema.options.join(", ")}: ${text}`,
      );
}

function parseRole(text: string): MetaResult<MetaRole> {
  const parsed = MetaRoleSchema.safeParse(text.toUpperCase());
  return parsed.success
    ? { ok: true, value: parsed.data }
    : invalid(
        `Role must be one of ${MetaRoleSchema.options.join(", ")}: ${text}`,
      );
}

/** Parse user-supplied selection text; undefined parts stay undefined. */
export function parseMetaSelection(input: {
  patch?: string | null | undefined;
  queue?: string | null | undefined;
  bracket?: string | null | undefined;
  role?: string | null | undefined;
}): MetaResult<MetaSelection> {
  const patch = present(input.patch);
  const queue = present(input.queue);
  const bracket = present(input.bracket);
  const role = present(input.role);
  const parsedPatch = patch === undefined ? undefined : parsePatch(patch);
  const parsedQueue = queue === undefined ? undefined : parseQueue(queue);
  const parsedBracket =
    bracket === undefined ? undefined : parseBracket(bracket);
  const parsedRole = role === undefined ? undefined : parseRole(role);
  for (const parsed of [parsedPatch, parsedQueue, parsedBracket, parsedRole]) {
    if (parsed?.ok === false) return parsed;
  }
  return {
    ok: true,
    value: {
      patch: parsedPatch?.ok === true ? parsedPatch.value : undefined,
      queueId: parsedQueue?.ok === true ? parsedQueue.value : undefined,
      bracket: parsedBracket?.ok === true ? parsedBracket.value : undefined,
      role: parsedRole?.ok === true ? parsedRole.value : undefined,
    },
  };
}

type Resolved = Pick<MetaContext, "patch" | "queueId" | "bracket">;

/** Fill a selection's missing parts from the manifest's defaults. */
export function resolveMetaSelection(
  manifest: MetaManifest,
  selection: MetaSelection,
): Resolved | undefined {
  const { defaults } = manifest;
  if (defaults === null) return undefined;
  return {
    patch: selection.patch ?? defaults.patch,
    queueId: selection.queueId ?? defaults.queueId,
    bracket: selection.bracket ?? defaults.bracket,
  };
}

function sameSlice(context: Resolved, wanted: Resolved): boolean {
  return (
    context.patch === wanted.patch &&
    context.queueId === wanted.queueId &&
    context.bracket === wanted.bracket
  );
}

const UNAVAILABLE = failure(
  "meta_unavailable",
  "Champion meta has not been published yet",
);

async function manifestOrFailure(
  reader: MetaReader,
): Promise<MetaResult<MetaManifest>> {
  const manifest = await reader.manifest();
  return manifest === undefined ? UNAVAILABLE : { ok: true, value: manifest };
}

export function championInManifest(
  manifest: MetaManifest,
  championId: number,
): { id: number; name: string } | undefined {
  return manifest.champions.find((champion) => champion.id === championId);
}

function normalizeName(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

/** A champion id or a name ("Lee Sin", "leesin") to its manifest entry. */
export function findChampion(
  manifest: MetaManifest,
  idOrName: string,
): { id: number; name: string } | undefined {
  const asId = Number(idOrName);
  if (idOrName.trim() !== "" && Number.isInteger(asId)) {
    return championInManifest(manifest, asId);
  }
  const wanted = normalizeName(idOrName);
  return manifest.champions.find(
    (champion) => normalizeName(champion.name) === wanted,
  );
}

function unknownChampion(id: number | string): MetaFailure {
  return failure(
    "unknown_champion",
    `No champion meta for champion ${id.toString()}: it is not a champion, or it has too few games in the crawl`,
  );
}

function sliceMissing(wanted: Resolved): MetaFailure {
  return failure(
    "slice_not_found",
    `No data for patch ${wanted.patch}, queue ${wanted.queueId.toString()}, bracket ${wanted.bracket} that meets the minimum sample`,
  );
}

export type ChampionLookup = {
  manifest: MetaManifest;
  buildId: string;
  championId: number;
  championName: string;
  context: Resolved & { queue: string };
  slices: ChampionSlice[];
};

export async function lookupChampion(
  reader: MetaReader,
  championId: number,
  selection: MetaSelection,
): Promise<MetaResult<ChampionLookup>> {
  const manifest = await manifestOrFailure(reader);
  if (!manifest.ok) return manifest;
  if (championInManifest(manifest.value, championId) === undefined) {
    return unknownChampion(championId);
  }
  const wanted = resolveMetaSelection(manifest.value, selection);
  if (wanted === undefined) return UNAVAILABLE;
  const file = await reader.champion(championId);
  if (file === undefined) return unknownChampion(championId);
  const slices = file.slices.filter(
    (slice) =>
      sameSlice(slice.context, wanted) &&
      (selection.role === undefined || slice.context.role === selection.role),
  );
  if (slices.length === 0) return sliceMissing(wanted);
  return {
    ok: true,
    value: {
      manifest: manifest.value,
      buildId: file.buildId,
      championId: file.championId,
      championName: file.championName,
      context: {
        ...wanted,
        queue: META_QUEUE_LABELS[wanted.queueId] ?? wanted.queueId.toString(),
      },
      slices,
    },
  };
}

export type TiersLookup = { manifest: MetaManifest; file: TierFile };

export async function lookupTiers(
  reader: MetaReader,
  selection: MetaSelection,
): Promise<MetaResult<TiersLookup>> {
  const manifest = await manifestOrFailure(reader);
  if (!manifest.ok) return manifest;
  const wanted = resolveMetaSelection(manifest.value, selection);
  if (wanted === undefined) return UNAVAILABLE;
  const summary = manifest.value.tiers.find((tier) => sameSlice(tier, wanted));
  if (summary === undefined) return sliceMissing(wanted);
  const file = await reader.tier(summary.path);
  return file === undefined
    ? sliceMissing(wanted)
    : { ok: true, value: { manifest: manifest.value, file } };
}

export type MatchupLookup = {
  buildId: string;
  championId: number;
  championName: string;
  opponentId: number;
  opponentName: string;
  context: Resolved & { queue: string };
  slices: {
    context: MatchupFile["slices"][number]["context"];
    games: number;
    wins: number;
    winRate: MatchupFile["slices"][number]["opponents"][number]["winRate"];
  }[];
};

export async function lookupMatchup(
  reader: MetaReader,
  championId: number,
  opponentId: number,
  selection: MetaSelection,
): Promise<MetaResult<MatchupLookup>> {
  const manifest = await manifestOrFailure(reader);
  if (!manifest.ok) return manifest;
  const champion = championInManifest(manifest.value, championId);
  if (champion === undefined) return unknownChampion(championId);
  const opponent = championInManifest(manifest.value, opponentId);
  if (opponent === undefined) return unknownChampion(opponentId);
  const wanted = resolveMetaSelection(manifest.value, selection);
  if (wanted === undefined) return UNAVAILABLE;
  const file = await reader.matchups(championId);
  const slices = (file?.slices ?? []).flatMap((slice) => {
    if (!sameSlice(slice.context, wanted)) return [];
    if (selection.role !== undefined && slice.context.role !== selection.role) {
      return [];
    }
    const entry = slice.opponents.find(
      (candidate) => candidate.championId === opponentId,
    );
    return entry === undefined
      ? []
      : [
          {
            context: slice.context,
            games: entry.games,
            wins: entry.wins,
            winRate: entry.winRate,
          },
        ];
  });
  if (file === undefined || slices.length === 0) {
    return failure(
      "matchup_not_found",
      `${champion.name} against ${opponent.name} has too few games in patch ${wanted.patch}, queue ${wanted.queueId.toString()}, bracket ${wanted.bracket} to report`,
    );
  }
  return {
    ok: true,
    value: {
      buildId: file.buildId,
      championId,
      championName: champion.name,
      opponentId,
      opponentName: opponent.name,
      context: {
        ...wanted,
        queue: META_QUEUE_LABELS[wanted.queueId] ?? wanted.queueId.toString(),
      },
      slices,
    },
  };
}
