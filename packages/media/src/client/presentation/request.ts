import type { MediaItem } from "#shared/contract.ts";
import type { MovieEditionFulfillment } from "#shared/movie-editions/fulfillment.ts";
import type { Copy } from "./copy.ts";

/** Where a film request for a particular edition stands. */
export const MOVIE_FULFILLMENT_COPY = {
  not_applicable: { label: "Asked for", tone: "neutral" },
  pending_choice: { label: "Choose a version", tone: "warn" },
  pending_edition: { label: "Waiting for that edition", tone: "progress" },
  pending_asset: { label: "Waiting for a copy", tone: "progress" },
  protected: { label: "On hold", tone: "warn" },
  fulfilled: { label: "Ready to watch", tone: "ok" },
} as const satisfies Record<MovieEditionFulfillment["status"], Copy>;

export const REQUEST_CANCELLED: Copy = {
  label: "Request cancelled",
  tone: "neutral",
};

/** A subtitle language as people write it: "English", not "en". */
function languageName(code: string): string {
  return (
    new Intl.DisplayNames(undefined, { type: "language" }).of(code) ?? code
  );
}

/** "English and Chinese subtitles", or null when none were asked for. */
export function subtitlesPhrase(languages: readonly string[]): string | null {
  if (languages.length === 0) return null;
  const list = new Intl.ListFormat(undefined, { type: "conjunction" }).format(
    languages.map((code) => languageName(code)),
  );
  return `${list} subtitles`;
}

type Asked = Pick<
  MediaItem,
  "kind" | "title" | "seasonNumber" | "episodeNumber"
>;

/** A season or episode by its numbers and, for an episode, its name. */
function partName(item: Asked): string {
  return item.kind === "season"
    ? `Season ${String(item.seasonNumber)}`
    : `Season ${String(item.seasonNumber)}, episode ${String(item.episodeNumber)}: ${item.title}`;
}

/** What a request asks for, in the words of the person who made it. */
export const ASKED_FOR_COPY = {
  movie: () => "The film",
  series: (_item, options) =>
    [
      "The whole series",
      ...(options.future ? ["new episodes as they air"] : []),
      ...(options.specials ? ["specials"] : []),
    ].join(", "),
  season: (item) => partName(item),
  episode: (item) => partName(item),
} as const satisfies Record<
  MediaItem["kind"],
  (item: Asked, options: { future: boolean; specials: boolean }) => string
>;
