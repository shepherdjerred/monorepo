import type { Artwork } from "#shared/artwork/contract.ts";
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

/** A size-less TMDB file path: a slash, 27 characters and the extension. */
export function posterPath(title: string): string {
  return `/${sha256(title).slice(0, 27)}.jpg`;
}

export function backdropPath(title: string): string {
  return `/${sha256(`backdrop:${title}`).slice(0, 27)}.jpg`;
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

export function storedOverview(title: Title): string | null {
  return observed(title) ? synopsis(title.title) : null;
}
