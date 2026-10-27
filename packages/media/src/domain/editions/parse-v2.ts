import type { CutConclusion, CutKind } from "#shared/editions/evidence.ts";
import type { MovieCutEvidenceV2 } from "#shared/movie-editions/cut-v2.ts";
import { parseCutEvidence } from "./parse.ts";
import {
  contained,
  metadataPosition,
  recognizedMarkers,
  words,
  type Marker,
} from "./tokens.ts";

const CONVENTIONAL: Readonly<Record<string, CutKind>> = {
  extended: "extended_cut",
  theatrical: "theatrical_cut",
  unrated: "unrated_cut",
  uncut: "uncut_version",
};

function conventionalMarker(token: string): CutKind | null {
  const values = words(token).map((word) => word.value);
  if (values[0] === "edition") values.shift();
  return values.length === 1 ? (CONVENTIONAL[values[0] ?? ""] ?? null) : null;
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

function plexMarkers(text: string): Marker[] {
  return [...text.matchAll(/\{edition-([^{}\r\n]{1,80})\}/gu)].flatMap(
    (match) => {
      const label = match[1];
      if (label === undefined)
        throw new Error("Edition wrapper omitted its label");
      const tokens = words(label);
      const phrases = recognizedMarkers(label, tokens);
      const cuts = [
        ...new Set(
          phrases.flatMap((marker) =>
            marker.cut === null ? [] : [marker.cut],
          ),
        ),
      ];
      const cut =
        conventionalMarker(label) ??
        (cuts.length === 1 && tokens.every((token) => contained(token, phrases))
          ? cuts[0]
          : null);
      return cut == null
        ? []
        : [
            {
              start: match.index,
              end: match.index + match[0].length,
              token: match[0],
              cut,
            },
          ];
    },
  );
}

/** Conventional filename labels are assertions about a cut, never content verification. */
export function parseMovieCutV2(
  input: Parameters<typeof parseCutEvidence>[0],
): MovieCutEvidenceV2 {
  const original = parseCutEvidence(input);
  const base = {
    ...original,
    schemaVersion: 2 as const,
    parserVersion: "cut-markers-v2" as const,
  };
  return { ...base, ...conventionalMovieCutTexts(original) };
}

export function conventionalMovieCutTexts(
  original: Pick<MovieCutEvidenceV2, "texts" | "issues" | "conclusion">,
): Pick<MovieCutEvidenceV2, "texts" | "issues" | "conclusion"> {
  if (original.issues.includes("input_limit_exceeded")) return original;
  const texts = original.texts.map((text) => {
    const wrappers = plexMarkers(text.text).filter(
      (marker) => !contained(marker, text.canonicalSpans),
    );
    const markers = text.markers
      .filter((marker) => !contained(marker, wrappers))
      .map((marker) => ({
        ...marker,
        cut: marker.cut ?? conventionalMarker(marker.token),
      }));
    markers.push(...wrappers);
    for (const token of words(text.text)) {
      const cut = CONVENTIONAL[token.value];
      if (
        cut === undefined ||
        contained(token, text.canonicalSpans) ||
        contained(token, markers) ||
        !metadataPosition(text.text, token, text.canonicalSpans)
      )
        continue;
      markers.push({
        start: token.start,
        end: token.end,
        token: text.text.slice(token.start, token.end),
        cut,
      });
    }
    return { ...text, markers: markers.toSorted((a, b) => a.start - b.start) };
  });
  const markers = texts.flatMap((text) => text.markers);
  return {
    texts,
    issues: markers.some((marker) => marker.cut === null)
      ? ["unsupported_cut_qualifier"]
      : [],
    conclusion: conclusion(markers),
  };
}
