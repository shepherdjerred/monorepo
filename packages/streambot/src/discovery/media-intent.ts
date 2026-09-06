import { z } from "zod";

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
});
export type MediaIntent = z.infer<typeof MediaIntentSchema>;

function normalizeWork(value: string): string {
  return value
    .trim()
    .replaceAll(/\bbegging\b/giu, "Beggin")
    .replaceAll(/\s+/gu, " ");
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
  const cleaned = query
    .replace(/^(?:play|watch|queue)\s+/iu, "")
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
