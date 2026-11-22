import type { z } from "zod";
import type { RequestList } from "#shared/api.ts";
import type { RequestInterestListSchema } from "#shared/household/interests.ts";
import type { MovieEditionRequestViewV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import type { ImportedPersonalClaim } from "#shared/personal-migration/contract.ts";

export type Request = RequestList[number];
export type Interest = z.infer<
  typeof RequestInterestListSchema
>["items"][number];
export type MovieRequest = z.infer<typeof MovieEditionRequestViewV4Schema>;

/**
 * One thing a person asked for, joined from the three reads that each know
 * part of it. They share the request's id:
 *
 * - `request`: the row of `GET /requests`, which names the title it belongs
 *   to and how far along it is;
 * - `interest`: whether the person still follows it, and any "still
 *   watching?" check waiting on them;
 * - `movie`: a film request's edition and what it allows.
 */
export type MineAsk = {
  requestId: string;
  userId: string | null;
  request: Request | null;
  interest: Interest | null;
  movie: MovieRequest | null;
  imported: ImportedPersonalClaim | null;
};

/** A film or series with everything asked of it, shown once. */
export type MineTitle = {
  rootMediaId: string;
  /**
   * Null for a film the reader may protect but whose library details they
   * may not see: its request says only that it is theirs.
   */
  name: string | null;
  posterPath: string | null;
  asks: MineAsk[];
  /** Seasons and episodes an ask fans out to; each is its own request row. */
  covered: Request[];
  /** A "still watching?" check on one of the asks is waiting for an answer. */
  needsAnswer: boolean;
};

/**
 * Whether the person has let this ask go: they finished it, stopped following
 * it, or never answered its check. The request itself stays `active` when
 * they do, so the interest is what says Media no longer acquires it for them.
 * A request with no interest of its own says nothing of the kind.
 */
export function releasedInterest(interest: Interest | null): boolean {
  return interest !== null && interest.interestState !== "following";
}

export function awaitsAnswer(interest: Interest | null): boolean {
  return (
    interest !== null &&
    interest.noticeEventId !== null &&
    interest.interestState === "following"
  );
}

function rootOf(ask: MineAsk): string {
  const root =
    ask.request?.rootMediaId ??
    ask.movie?.scope.mediaId ??
    ask.interest?.mediaId;
  if (root === undefined) throw new Error("An ask names no title");
  return root;
}

function nameOf(asks: readonly MineAsk[], covered: readonly Request[]) {
  if (asks.some((ask) => ask.movie?.access === "protection_only")) return null;
  for (const ask of asks) {
    if (ask.request !== null) return ask.request.rootTitle;
    if (ask.movie?.access === "detail") return ask.movie.title;
  }
  const [part] = covered;
  // Without a covered part only an interest is left: it names what was asked
  // for, which is the title itself unless the ask was for a season or an
  // episode.
  return part === undefined
    ? (asks.find((ask) => ask.interest !== null)?.interest?.title ?? null)
    : part.rootTitle;
}

function posterOf(asks: readonly MineAsk[], covered: readonly Request[]) {
  for (const ask of asks) {
    const poster =
      ask.request?.artwork.posterPath ?? ask.interest?.artwork?.posterPath;
    if (poster !== undefined && poster !== null) return poster;
  }
  return covered[0]?.artwork.posterPath ?? null;
}

/**
 * Everything the reads say about the reader's titles, one entry per film or
 * series: the titles that need an answer first, then by name.
 *
 * A row of `GET /requests` is an ask when a person made it directly: it has
 * an interest or a film request of its own, or it is for the film or series
 * itself. Every other row is a season or episode that such an ask covers.
 */
export function mineTitles(input: {
  requests: readonly Request[];
  interests: readonly Interest[];
  movieRequests: readonly MovieRequest[];
  /** Whose film requests `movieRequests` are. */
  movieSubjectId: string;
  imported: readonly ImportedPersonalClaim[];
}): MineTitle[] {
  const requests = new Map(input.requests.map((row) => [row.id, row]));
  const interests = new Map(input.interests.map((row) => [row.requestId, row]));
  const movies = new Map(
    input.movieRequests.map((row) => [row.requestId, row]),
  );
  const imported = new Map(input.imported.map((row) => [row.requestId, row]));

  const asked = new Set([...interests.keys(), ...movies.keys()]);
  for (const row of input.requests)
    if (row.mediaId === row.rootMediaId) asked.add(row.id);

  const titles = new Map<string, { asks: MineAsk[]; covered: Request[] }>();
  const titleOf = (rootMediaId: string) => {
    const existing = titles.get(rootMediaId);
    if (existing !== undefined) return existing;
    const created = { asks: [], covered: [] };
    titles.set(rootMediaId, created);
    return created;
  };
  for (const requestId of asked) {
    const request = requests.get(requestId) ?? null;
    const interest = interests.get(requestId) ?? null;
    const movie = movies.get(requestId) ?? null;
    const ask: MineAsk = {
      requestId,
      userId:
        request?.userId ??
        interest?.userId ??
        (movie === null ? null : input.movieSubjectId),
      request,
      interest,
      movie,
      imported: imported.get(requestId) ?? null,
    };
    titleOf(rootOf(ask)).asks.push(ask);
  }
  for (const row of input.requests)
    if (!asked.has(row.id)) titleOf(row.rootMediaId).covered.push(row);

  return [...titles]
    .map(([rootMediaId, { asks, covered }]): MineTitle => {
      const name = nameOf(asks, covered);
      return {
        rootMediaId,
        name,
        // A withheld title withholds its poster too.
        posterPath: name === null ? null : posterOf(asks, covered),
        asks,
        covered,
        needsAnswer: asks.some((ask) => awaitsAnswer(ask.interest)),
      };
    })
    .sort(
      (left, right) =>
        Number(right.needsAnswer) - Number(left.needsAnswer) ||
        (left.name ?? "￿").localeCompare(right.name ?? "￿"),
    );
}
