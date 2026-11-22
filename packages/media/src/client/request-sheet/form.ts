import { z } from "zod";
import {
  LanguageSchema,
  type MediaItem,
  type MediaUser,
} from "#shared/contract.ts";
import type { DefaultCommandV2 } from "#shared/editions/commands.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";

/** A season the reader can ask for on its own. */
type SheetSeason = {
  seasonNumber: number;
  title: string;
  /** Null when the catalog has not said how many episodes it has. */
  episodeCount: number | null;
};

/**
 * What a request sheet asks for. A title the household already has is named
 * by its media id; one it has not is named by its catalog id and joins the
 * library when the request is sent.
 */
export type SheetSubject = {
  title: string;
  target: { mediaId: string } | { externalId: number };
} & (
  | { kind: "movie" }
  | { kind: "series"; seasons: readonly SheetSeason[] }
  | { kind: "season"; seasonNumber: number | null }
  | { kind: "episode" }
);

/** A subject asked for through the series, season and episode commands. */
export type TelevisionSubject = Exclude<SheetSubject, { kind: "movie" }>;

/** How long the library keeps a title; empty until the owner has chosen. */
export type KeepingChoice = "" | "keep" | "temporary";

export type SheetValues = {
  /** Who the request is for: the reader, or a profile the owner manages. */
  requesterUserId: string;
  version: MovieEditionKey;
  keeping: KeepingChoice;
  languages: readonly string[];
  /** The whole series, or only the seasons ticked. */
  scope: "series" | "seasons";
  seasons: readonly number[];
  future: boolean;
  specials: boolean;
};

/** The API accepts at most this many subtitle languages on a request. */
export const LANGUAGE_LIMIT = 20;

/**
 * The sheet as it opens. A member's request is always just for now; the
 * owner says how long to keep the title, so that starts unanswered.
 */
export function initialValues(
  subject: SheetSubject,
  user: MediaUser,
): SheetValues {
  return {
    requesterUserId: user.id,
    version: "default",
    keeping: user.role === "owner" ? "" : "temporary",
    languages: ["en"],
    scope: "series",
    seasons: [],
    future: subject.kind === "series",
    specials: false,
  };
}

/** The version a `<select>` reports, which must be one the registry lists. */
export function readVersion(value: string): MovieEditionKey {
  return MovieEditionKeySchema.parse(value);
}

type Checked = {
  keepingPolicy: "keep" | "temporary";
  subtitleLanguages: string[];
};

/** What every request carries, or the sentence that says what is missing. */
function check(values: SheetValues): Checked | string {
  if (values.keeping === "") return "Choose how long to keep it.";
  const languages = z
    .array(LanguageSchema)
    .max(LANGUAGE_LIMIT)
    .safeParse([...new Set(values.languages)]);
  return languages.success
    ? { keepingPolicy: values.keeping, subtitleLanguages: languages.data }
    : `Choose at most ${String(LANGUAGE_LIMIT)} subtitle languages.`;
}

/**
 * Why the sheet cannot be sent as it stands, in the reader's words, or null
 * when it can.
 */
export function validationMessage(
  subject: SheetSubject,
  values: SheetValues,
): string | null {
  const problem = check(values);
  if (typeof problem === "string") return problem;
  return subject.kind === "series" &&
    values.scope === "seasons" &&
    values.seasons.length === 0
    ? "Choose at least one season."
    : null;
}

function checked(values: SheetValues): Checked {
  const result = check(values);
  if (typeof result === "string") throw new TypeError(result);
  return result;
}

type RequestCommand = Extract<
  DefaultCommandV2["command"],
  { action: "request" }
>;

/** The catalog files a series' specials under season zero. */
const SPECIALS_SEASON = 0;

/**
 * What one command of a request covers:
 *
 * - `series`: the whole series. Whether it follows new episodes and brings
 *   its specials are the sheet's two answers.
 * - `specials`: the Specials season, asked for by itself.
 * - `part`: a numbered season, or one episode, asked for as it is.
 */
export type RequestScope = "series" | "specials" | "part";

function seasonScope(seasonNumber: number | null): RequestScope {
  return seasonNumber === SPECIALS_SEASON ? "specials" : "part";
}

/** One command of a request: the library item it names and what it covers. */
export type RequestItem = {
  mediaId: string;
  /** The season the item is; null for a series or an episode. */
  seasonNumber: number | null;
  scope: RequestScope;
};

type LibrarySeason = Pick<MediaItem, "id" | "kind" | "seasonNumber">;

/**
 * The commands a request is made of, in the order they are sent: one for the
 * sheet's own subject, or one per chosen season. `children` are the series'
 * items in the library, where each chosen season is found by its number.
 */
export function requestItems(
  subject: TelevisionSubject,
  rootId: string,
  seasons: readonly number[],
  children: readonly LibrarySeason[],
): RequestItem[] {
  if (seasons.length === 0) {
    const seasonNumber =
      subject.kind === "season" ? subject.seasonNumber : null;
    return [
      {
        mediaId: rootId,
        seasonNumber,
        scope: subject.kind === "series" ? "series" : seasonScope(seasonNumber),
      },
    ];
  }
  return seasons.map((seasonNumber) => {
    const season = children.find(
      (child) => child.kind === "season" && child.seasonNumber === seasonNumber,
    );
    if (season === undefined) {
      throw new Error(
        `${seasonName(subject, seasonNumber)} is still being added to the library. Try again in a moment.`,
      );
    }
    return {
      mediaId: season.id,
      seasonNumber,
      scope: seasonScope(seasonNumber),
    };
  });
}

/** A season as the sheet lists it, or by its number when the sheet does not. */
function seasonName(subject: TelevisionSubject, seasonNumber: number): string {
  const listed =
    subject.kind === "series"
      ? subject.seasons.find((season) => season.seasonNumber === seasonNumber)
      : undefined;
  return listed?.title ?? `Season ${String(seasonNumber)}`;
}

/**
 * What to say when a request for several seasons stopped part-way: which
 * seasons are requested, which are not, and that the rest is asked for with
 * the same answers.
 */
export function partialMessage(
  subject: TelevisionSubject,
  requested: readonly number[],
  remaining: readonly number[],
): string {
  const names = (seasons: readonly number[]) =>
    new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(
      seasons.map((season) => seasonName(subject, season)),
    );
  return [
    `${names(requested)} ${requested.length === 1 ? "is" : "are"} requested.`,
    `${names(remaining)} ${remaining.length === 1 ? "is" : "are"} not yet.`,
    "Your answers stay as they were sent, so the rest is asked for the same way: choose Request to try again, or Cancel to leave it there.",
  ].join(" ");
}

/**
 * The command for a series, season or episode. Following new episodes is a
 * question about a whole series. So is bringing its specials, except for
 * the Specials season itself: the server leaves season-zero episodes out of
 * any request that does not include specials, a request for that season
 * among them.
 */
export function televisionCommand(
  values: SheetValues,
  user: MediaUser,
  scope: RequestScope,
): RequestCommand {
  return {
    action: "request",
    ...checked(values),
    includeFutureEpisodes: scope === "series" && values.future,
    includeSpecials:
      scope === "series" ? values.specials : scope === "specials",
    // The server reads an absent requester as the person sending it.
    ...(values.requesterUserId === user.id
      ? {}
      : { requesterUserId: values.requesterUserId }),
  };
}

/** What a film request adds to the version the reader chose. */
export function movieOptions(values: SheetValues): Checked {
  return checked(values);
}

/** The seasons a series request names, in season order; empty for the whole series. */
export function chosenSeasons(
  subject: SheetSubject,
  values: SheetValues,
): number[] {
  if (subject.kind !== "series" || values.scope === "series") return [];
  const known = new Set(subject.seasons.map((season) => season.seasonNumber));
  return [...new Set(values.seasons)]
    .filter((season) => known.has(season))
    .sort((left, right) => left - right);
}
