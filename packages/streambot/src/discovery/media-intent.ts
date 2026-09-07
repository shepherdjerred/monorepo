import { z } from "zod";
import {
  MediaModeSchema,
  type MediaMode,
} from "@shepherdjerred/streambot/sources/media-kind.ts";

export const MediaSourcePreferenceSchema = z.enum([
  "auto",
  "history",
  "local",
  "youtube",
]);
export type MediaSourcePreference = z.infer<typeof MediaSourcePreferenceSchema>;

export const MediaPlacementSchema = z.enum(["queue", "next", "now"]);
export type MediaPlacement = z.infer<typeof MediaPlacementSchema>;

export const MediaIntentSchema = z.strictObject({
  query: z.string().min(1),
  work: z.string().min(1).optional(),
  performer: z.string().min(1).optional(),
  rendition: z.enum(["original", "cover", "ai_cover", "unspecified"]),
  source: MediaSourcePreferenceSchema,
  placement: MediaPlacementSchema,
  selection: z.enum(["specific", "anything"]),
  subtitleLanguage: z.string().min(1).optional(),
  subtitles: z.enum(["auto", "off"]).optional(),
  /**
   * Transport implied by the verb the speaker used, when they used one. Absent means no signal —
   * NOT "auto" — because an explicit `mode:` option must be able to outrank a bare query, and a
   * defaulted value here would be indistinguishable from a deliberate choice.
   */
  mode: MediaModeSchema.optional(),
});
export type MediaIntent = z.infer<typeof MediaIntentSchema>;

function normalizeWork(value: string): string {
  return value
    .trim()
    .replaceAll(/\bbegging\b/giu, "Beggin")
    .replaceAll(/\s+/gu, " ");
}

/**
 * The transport a leading verb implies. "watch" is the only one that asks for a picture; "listen
 * to" and "put on" ask for the opposite. "play" and "queue" are transport-neutral in ordinary
 * speech — people say "play this" about songs and films alike — so they deliberately yield no
 * signal rather than a weak one that would outrank the classifier's metadata.
 */
function verbMode(verb: string | undefined): MediaMode | undefined {
  if (verb === undefined) return undefined;
  const normalized = verb.trim().toLocaleLowerCase("en-US");
  if (normalized === "watch") return "video";
  if (normalized === "listen to" || normalized === "put on") return "music";
  return undefined;
}

/** Turn the compact command surface into a structured, provider-neutral search intent. */
export function inferMediaIntent(input: {
  query: string;
  source?: MediaSourcePreference;
  placement?: MediaPlacement;
}): MediaIntent {
  const query = normalizeWork(input.query);
  const explicitAiCover = /\bai[ -]?covers?\b/iu.test(query);
  const explicitCover = explicitAiCover || /\bcovers?\b/iu.test(query);
  const explicitOriginal = /\boriginal(?: version)?\b/iu.test(query);
  const verb = /^(?:play|watch|queue|listen to|put on)\s+/iu.exec(query)?.[0];
  const cleaned = query
    .replace(/^(?:play|watch|queue|listen to|put on)\s+/iu, "")
    .replaceAll(/\bai[ -]?covers?\b/giu, "")
    .replaceAll(/\bcovers?\b/giu, "")
    .replaceAll(/\boriginal(?: version)?\b/giu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
  const byIndex = cleaned.toLocaleLowerCase("en-US").lastIndexOf(" by ");
  const work = normalizeWork(
    byIndex === -1 ? cleaned : cleaned.slice(0, byIndex),
  );
  const performer =
    byIndex === -1 ? undefined : cleaned.slice(byIndex + 4).trim();

  return MediaIntentSchema.parse({
    query,
    work,
    ...(performer === undefined ? {} : { performer }),
    rendition: explicitOriginal
      ? "original"
      : explicitAiCover
        ? "ai_cover"
        : explicitCover
          ? "cover"
          : "unspecified",
    source: input.source ?? "auto",
    placement: input.placement ?? "queue",
    selection: /\b(?:anything|whatever|surprise me)\b/iu.test(query)
      ? "anything"
      : "specific",
    ...(verbMode(verb) === undefined ? {} : { mode: verbMode(verb) }),
  });
}

/** Search spellings sent to providers. Character performances deliberately include AI-cover form. */
export function expandMediaQueries(intent: MediaIntent): string[] {
  const work = intent.work ?? intent.query;
  const performer = intent.performer;
  if (performer === undefined) return [intent.query];
  const ordinary = `${work} ${performer}`;
  switch (intent.rendition) {
    case "ai_cover":
      return [`${ordinary} AI cover`];
    case "cover":
      return [`${ordinary} cover`];
    case "original":
      return [`${ordinary} original`];
    case "unspecified":
      return [ordinary, `${ordinary} AI cover`];
  }
}

export function isHistoryReference(query: string): boolean {
  return /\b(?:again|that (?:song|video|episode|one)|previous|last one)\b/iu.test(
    query,
  );
}

/** Searchable subject left after removing conversational history-reference words. */
export function historyReferenceQuery(query: string): string {
  return query
    .replace(/^(?:play|watch|queue)\s+/iu, "")
    .replaceAll(
      /\b(?:that|the|song|video|episode|one|again|previous|last)\b/giu,
      "",
    )
    .replaceAll(/\s+/gu, " ")
    .trim();
}
