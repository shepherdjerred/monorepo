import type { Artwork } from "#shared/artwork/contract.ts";
import type { MediaItem } from "#shared/contract.ts";
import type { MediaReference } from "#shared/household/media-reference.ts";
import { sha256 } from "#testing/fixture-api/support.ts";
import type { Title } from "./titles.ts";

const SYNOPSES = new Map<string, string>([
  [
    "Dune: Part Two",
    "Paul Atreides unites with Chani and the Fremen while on a warpath of revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the universe, he endeavors to prevent a terrible future.",
  ],
  [
    "Severance",
    "Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives. When a mysterious colleague appears outside of work, it begins a journey to discover the truth about their jobs.",
  ],
  [
    "Anora",
    "A young sex worker from Brooklyn gets her chance at a Cinderella story when she meets and impulsively marries the son of an oligarch.",
  ],
]);

export function synopsis(title: string): string {
  return (
    SYNOPSES.get(title) ??
    `${title} — a household favourite. A story of ambition, loyalty and consequence that rewards a second watch.`
  );
}

/**
 * A size-less TMDB file path: a slash, 27 characters and the extension. TMDB
 * serves both JPEG and PNG; the fixtures name PNG files because that is what
 * the fixture artwork route draws (`artwork-image.ts`).
 */
export function posterPath(title: string): string {
  return `/${sha256(title).slice(0, 27)}.png`;
}

export function backdropPath(title: string): string {
  return `/${sha256(`backdrop:${title}`).slice(0, 27)}.png`;
}

/** What TMDB lists for a title. Some have no poster and some no backdrop. */
export function catalogArtwork(title: Title): Artwork {
  return {
    posterPath: title.index % 9 === 4 ? null : posterPath(title.title),
    backdropPath: title.index % 7 === 5 ? null : backdropPath(title.title),
  };
}

/** A few owned titles have not had their artwork observed yet. */
function observed(title: Title): boolean {
  return title.index % 11 !== 10;
}

/**
 * What Media has stored for an owned title, and so what every season and
 * episode row of it shows: TMDB's art once observed, nothing before that.
 */
export function storedArtwork(title: Title): Artwork {
  return observed(title)
    ? catalogArtwork(title)
    : { posterPath: null, backdropPath: null };
}

/**
 * How a row refers to `item`, the title itself or one of its episodes: the
 * item by its own id, kind and name, under the title as its named root.
 */
export function mediaReference(
  title: Title,
  item: Pick<MediaItem, "id" | "kind" | "title">,
): MediaReference {
  return {
    id: item.id,
    rootMediaId: title.id,
    rootTitle: title.title,
    kind: item.kind,
    title: item.title,
    artwork: storedArtwork(title),
  };
}

export function storedOverview(title: Title): string | null {
  return observed(title) ? synopsis(title.title) : null;
}

/** A film's runtime as TMDB lists it, by its TMDB id. TMDB does not know a few. */
export function filmRuntimeMinutes(tmdbId: number): number | null {
  return tmdbId % 13 === 5 ? null : 84 + (tmdbId % 97);
}
