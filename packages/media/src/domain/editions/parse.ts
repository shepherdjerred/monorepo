import { z } from "zod";
import {
  CutCanonicalSchema,
  CutSourceSchema,
  EditionTextSchema,
  type CutCanonical,
  type CutSource,
  type EditionText,
  type CutEvidence,
  type CutConclusion,
} from "#shared/editions/evidence.ts";
import {
  words,
  titleSpans,
  recognizedMarkers,
  metadataPosition,
  contained,
  type Marker,
} from "./tokens.ts";

const Input = z.strictObject({
  source: CutSourceSchema,
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  canonical: CutCanonicalSchema,
  attribution: z.enum(["provider_texts", "legacy_primary", "torrent_member"]),
  texts: z.array(EditionTextSchema),
});
export function parseCutEvidence(input: {
  source: CutSource;
  sourceDigest: string;
  canonical: CutCanonical;
  attribution: CutEvidence["attribution"];
  texts: readonly EditionText[];
}): CutEvidence {
  const value = Input.parse(input);
  const base = {
    schemaVersion: 1 as const,
    parserVersion: "cut-markers-v1" as const,
    source: value.source,
    sourceDigest: value.sourceDigest,
    canonicalDigest: value.canonical.digest,
    attribution: value.attribution,
  };
  if (exceedsBounds(value))
    return {
      ...base,
      texts: [],
      issues: ["input_limit_exceeded"],
      conclusion: { kind: "ambiguous" },
    };
  const texts = value.texts.map((item) => parseText(item, value.canonical));
  const markers = texts.flatMap((item) => item.markers);
  const ambiguous = markers.some((marker) => marker.cut === null);
  return {
    ...base,
    texts,
    issues: ambiguous ? ["unsupported_cut_qualifier"] : [],
    conclusion: conclusion(markers),
  };
}
function exceedsBounds(value: z.infer<typeof Input>): boolean {
  const maximum = value.attribution === "torrent_member" ? 4096 : 500;
  return (
    value.texts.length === 0 ||
    value.texts.length > 20 ||
    value.texts.some(
      (item) =>
        item.text.length === 0 ||
        item.text.length > maximum ||
        item.provenance.field.length > 100,
    ) ||
    value.canonical.title.length > 500 ||
    value.canonical.aliases.length > 501 ||
    value.canonical.aliases.some((alias) => alias.length > 500) ||
    (value.canonical.episodeTitles?.length ?? 0) > 100 ||
    value.canonical.episodeTitles?.some(
      (episode) => episode.title.length > 500,
    ) === true
  );
}
function parseText(item: EditionText, canonical: CutCanonical) {
  const tokens = words(item.text);
  const canonicalSpans = titleSpans(item.text, tokens, canonical);
  const markers = recognizedMarkers(item.text, tokens).filter(
    (marker) =>
      !contained(marker, canonicalSpans) &&
      metadataPosition(item.text, marker, canonicalSpans),
  );
  addUnknownWrappers(item.text, canonicalSpans, markers);
  addUnknownQualifiers(item.text, canonicalSpans, markers);
  return {
    ...item,
    canonicalSpans,
    markers: markers.toSorted((a, b) => a.start - b.start),
  };
}
function addUnknownWrappers(
  text: string,
  canonicalSpans: readonly { start: number; end: number }[],
  markers: Marker[],
): void {
  for (const match of text.matchAll(/[[{(][^\]})]{1,500}[\]})]/gu)) {
    const span = { start: match.index, end: match.index + match[0].length };
    if (contained(span, canonicalSpans)) continue;
    if (
      /\b(?:edition|cut|version)\b/iu.test(match[0]) &&
      !markers.some((marker) => contained(marker, [span])) &&
      !canonicalSpans.some((title) => contained(title, [span]))
    )
      markers.push({ ...span, token: match[0], cut: null });
  }
}
function addUnknownQualifiers(
  text: string,
  canonicalSpans: readonly { start: number; end: number }[],
  markers: Marker[],
): void {
  const tokens = words(text);
  for (const [index, token] of tokens.entries()) {
    if (contained(token, canonicalSpans) || contained(token, markers)) continue;
    const qualifier = ["cut", "edition", "version"].includes(token.value);
    const bare = ["extended", "unrated", "uncut", "dc"].includes(token.value);
    if (!qualifier && !bare) continue;
    const starts = qualifier ? [index, index - 1, index - 2] : [index];
    const start = starts
      .map((offset) => tokens[offset]?.start)
      .find(
        (offset) =>
          offset !== undefined &&
          metadataPosition(
            text,
            { start: offset, end: token.end },
            canonicalSpans,
          ),
      );
    if (start !== undefined)
      markers.push({
        start,
        end: token.end,
        token: text.slice(start, token.end),
        cut: null,
      });
  }
}
function conclusion(markers: readonly Marker[]): CutConclusion {
  const cuts = [
    ...new Set(
      markers.flatMap((marker) => (marker.cut === null ? [] : [marker.cut])),
    ),
  ].sort();
  if (cuts.length > 1) return { kind: "conflict", cuts };
  if (markers.some((marker) => marker.cut === null))
    return { kind: "ambiguous" };
  const cut = cuts[0];
  return cut === undefined
    ? { kind: "standard_unmarked" }
    : { kind: "named", cut };
}
