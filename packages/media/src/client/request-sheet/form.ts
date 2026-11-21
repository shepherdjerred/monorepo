import { z } from "zod";
import { LanguageSchema, type MediaUser } from "#shared/contract.ts";
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
  | { kind: "season" | "episode" }
);

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

/**
 * The command for a series, season or episode. Following new episodes and
 * including specials are questions about a whole series: a season or an
 * episode is asked for as it is.
 */
export function televisionCommand(
  values: SheetValues,
  user: MediaUser,
  whole: boolean,
): RequestCommand {
  return {
    action: "request",
    ...checked(values),
    includeFutureEpisodes: whole && values.future,
    includeSpecials: whole && values.specials,
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
