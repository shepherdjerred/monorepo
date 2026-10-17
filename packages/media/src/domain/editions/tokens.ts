import type { CutCanonical, CutKind } from "#shared/editions/evidence.ts";
import { parseEpisodeCoordinates } from "#domain/acquisition-identity/parser.ts";

export type Token = { value: string; start: number; end: number };
export type Span = { start: number; end: number };
export type Marker = Span & { token: string; cut: CutKind | null };
export function words(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    value: match[0].normalize("NFKC").toLowerCase(),
    start: match.index,
    end: match.index + match[0].length,
  }));
}
function matches(
  tokens: readonly Token[],
  index: number,
  values: readonly string[],
): boolean {
  return values.every(
    (value, offset) => tokens[index + offset]?.value === value,
  );
}
export function titleSpans(
  text: string,
  tokens: readonly Token[],
  canonical: CutCanonical,
): Span[] {
  return [
    ...matchingTitleSpans({
      text,
      tokens,
      titles: [canonical.title, ...canonical.aliases],
      episode: false,
    }),
    ...matchingTitleSpans({
      text,
      tokens,
      titles: episodeTitles(text, canonical),
      episode: true,
    }),
  ].sort((a, b) => a.start - b.start);
}
function episodeTitles(text: string, canonical: CutCanonical): string[] {
  const evidence = parseEpisodeCoordinates(text);
  const form = evidence.forms[0];
  if (
    form === undefined ||
    evidence.invalid ||
    evidence.forms.length !== 1 ||
    form.kind === "unknown" ||
    form.kind === "season_pack" ||
    form.form !== "single"
  )
    return [];
  const number = form.episodes[0];
  const episodes = (canonical.episodeTitles ?? []).filter((episode) =>
    form.kind === "absolute"
      ? episode.absoluteNumber === number
      : episode.seasonNumber === form.season &&
        episode.episodeNumber === number,
  );
  return episodes.length === 1 ? episodes.map((episode) => episode.title) : [];
}
function matchingTitleSpans(input: {
  text: string;
  tokens: readonly Token[];
  titles: readonly string[];
  episode: boolean;
}): Span[] {
  const { text, tokens } = input;
  const result: Span[] = [];
  for (const title of input.titles) {
    const values = words(title).map((token) => token.value);
    if (values.length === 0) continue;
    for (const [index, token] of tokens.entries()) {
      if (!matches(tokens, index, values)) continue;
      const end = tokens[index + values.length - 1]?.end;
      if (
        end !== undefined &&
        titlePosition(text.slice(0, token.start), input.episode)
      )
        result.push({ start: token.start, end });
    }
  }
  return result;
}
function titlePosition(prefix: string, episode: boolean): boolean {
  if (episode)
    return /(?:\bS\d{1,3}[ ._-]*E\d{1,4}|\b\d{1,3}x\d{1,4}|\s-\s\d{1,4}(?:v\d+)?)[ ._-]+$/iu.test(
      prefix,
    );
  const segment = prefix.split(/[/\\]/u).at(-1) ?? "";
  // Only title-position matches suppress cuts; repeated aliases in metadata do not.
  return /^(?:\[[^\]]{1,100}\])?[ ._([{-]*$/u.test(segment);
}
const CUTS: readonly { values: readonly string[]; cut: CutKind }[] = [
  { values: ["director", "s", "cut"], cut: "directors_cut" },
  { values: ["directors", "cut"], cut: "directors_cut" },
  { values: ["extended", "cut"], cut: "extended_cut" },
  { values: ["extended", "edition"], cut: "extended_cut" },
  { values: ["theatrical", "cut"], cut: "theatrical_cut" },
  { values: ["theatrical", "version"], cut: "theatrical_cut" },
  { values: ["final", "cut"], cut: "final_cut" },
  { values: ["unrated", "cut"], cut: "unrated_cut" },
  { values: ["unrated", "version"], cut: "unrated_cut" },
  { values: ["uncut", "version"], cut: "uncut_version" },
];
export function recognizedMarkers(
  text: string,
  tokens: readonly Token[],
): Marker[] {
  return tokens.flatMap((token, index) =>
    CUTS.flatMap(({ values, cut }) => {
      const end = tokens[index + values.length - 1]?.end;
      return end !== undefined && matches(tokens, index, values)
        ? [
            {
              start: token.start,
              end,
              token: text.slice(token.start, end),
              cut,
            },
          ]
        : [];
    }),
  );
}
export function contained(span: Span, containers: readonly Span[]): boolean {
  return containers.some(
    (container) => span.start >= container.start && span.end <= container.end,
  );
}
const TECHNICAL =
  /^(?:s\d{1,3}(?:e\d{1,4})*|e\d{1,4}|\d{1,4}|\d{3,4}p|web|dl|webrip|webdl|bluray|blu|ray|remux|h264|h265|x264|x265|hevc|avc|av1|eng|english|multi|dual|audio|hdr|hdr10|dv|imax|remastered|remaster|proper|repack|complete)$/u;
export function metadataPosition(
  text: string,
  marker: Span,
  titles: readonly Span[],
): boolean {
  const prefix = text.slice(0, marker.start);
  if (/[[{(][^\]})]*$/u.test(prefix)) return true;
  const suffix = text.slice(marker.end);
  // A cut at a directory boundary or immediately before a file extension is
  // filename metadata even when that component lacks the catalog title.
  if (/^[ ._-]*[/\\]/u.test(suffix) || /^\.[a-z0-9]{1,10}$/iu.test(suffix))
    return true;
  const before = prefix.split(/[/\\]/u).at(-1) ?? "";
  if (
    before.trim() === "" &&
    /^(?:[ ._-]*|\.[a-z0-9]+|[ ._-]*[/\\].*)$/iu.test(text.slice(marker.end))
  )
    return true;
  const outside = words(prefix).filter((token) => !contained(token, titles));
  if (
    outside.some((token) =>
      /^(?:(?:19|20)\d{2}|s\d{1,3}e\d{1,4}|\d{3,4}p)$/u.test(token.value),
    )
  )
    return true;
  if (/^[ ._-]*(?:\d{3,4}p|WEB[ ._-]?DL|BluRay)/iu.test(text.slice(marker.end)))
    return true;
  const title = titles.findLast((span) => span.end <= marker.start);
  return (
    title !== undefined &&
    words(text.slice(title.end, marker.start)).every((token) =>
      TECHNICAL.test(token.value),
    )
  );
}
