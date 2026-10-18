import type {
  EpisodeCoordinateEvidence,
  EpisodeCoordinateForm,
} from "#shared/acquisition/coordinates.ts";

type Numbered = { episodes: number[]; form: "single" | "range" | "list" };
function numbers(first: string, tail: string): Numbered | null {
  const start = Number(first);
  if (tail.trimStart().startsWith("-")) {
    const end = Number(tail.replace(/^[ ._]*-[ ._]*E?/iu, ""));
    if (!Number.isSafeInteger(end) || end < start || end - start >= 100)
      return null;
    return {
      episodes: Array.from(
        { length: end - start + 1 },
        (_, index) => start + index,
      ),
      form: "range",
    };
  }
  const rest = [...tail.matchAll(/\d+/gu)].map((match) => Number(match[0]));
  const episodes = [start, ...rest];
  if (episodes.length > 100 || new Set(episodes).size !== episodes.length)
    return null;
  return { episodes, form: rest.length === 0 ? "single" : "list" };
}

function numberedForms(name: string) {
  const forms: EpisodeCoordinateForm[] = [];
  const spans: { start: number; end: number }[] = [];
  let invalid = false;
  const patterns = [
    /\bS(?<season>\d{1,3})[ ._-]*E(?<first>\d{1,4})(?<tail>[ ._]*-[ ._]*E?\d{1,4}|(?:[ ._]*E\d{1,4})*)(?!\d)/giu,
    /\b(?<season>\d{1,3})x(?<first>\d{1,4})(?<tail>-\d{1,4}|(?:x\d{1,4})*)(?!\d)/giu,
  ];
  for (const pattern of patterns) {
    for (const match of name.matchAll(pattern)) {
      const groups = match.groups;
      if (groups?.["season"] === undefined || groups["first"] === undefined)
        throw new Error("Coordinate capture missing");
      const parsed = numbers(groups["first"], groups["tail"] ?? "");
      spans.push({ start: match.index, end: match.index + match[0].length });
      if (
        parsed === null ||
        /^[ ._]*(?:-[ ._]*E?|[Ex])\d/iu.test(
          name.slice(match.index + match[0].length),
        )
      )
        invalid = true;
      else
        forms.push({
          kind: "season_episodes",
          season: Number(groups["season"]),
          ...parsed,
        });
    }
  }
  return { forms, spans, invalid };
}

function packForms(name: string, spans: { start: number; end: number }[]) {
  const forms: EpisodeCoordinateForm[] = [];
  for (const match of name.matchAll(
    /\b(?:S(?<short>\d{1,3})|Season[ ._-]+(?<long>\d{1,3}))\b/giu,
  )) {
    if (
      spans.some((span) => match.index >= span.start && match.index < span.end)
    )
      continue;
    const season = match.groups?.["short"] ?? match.groups?.["long"];
    if (season === undefined) throw new Error("Season capture missing");
    forms.push({ kind: "season_pack", season: Number(season) });
  }
  return forms;
}

function absoluteForms(name: string) {
  const forms: EpisodeCoordinateForm[] = [];
  let invalid = false;
  const absolute =
    /\s-\s(?<first>\d{1,4})(?<tail>-\d{1,4}|(?:[+&,][ ._]*\d{1,4})*)(?:v\d+)?(?=[\s[(]|$)/giu;
  for (const match of name.matchAll(absolute)) {
    const first = match.groups?.["first"];
    if (first === undefined) throw new Error("Absolute capture missing");
    const parsed = numbers(first, match.groups?.["tail"] ?? "");
    if (parsed === null || parsed.episodes.includes(0)) invalid = true;
    else forms.push({ kind: "absolute", ...parsed });
  }
  return { forms, invalid };
}

/** New acquisition evidence only; historical parseReleaseName output is unchanged. */
export function parseEpisodeCoordinates(
  value: string,
): EpisodeCoordinateEvidence {
  if (value.length > 4096) return { forms: [], invalid: true };
  const name = value.replace(/\.(?:mkv|mp4|m4v|avi|ts)$/iu, "");
  const numbered = numberedForms(name);
  const absolute = absoluteForms(name);
  const forms = [
    ...numbered.forms,
    ...packForms(name, numbered.spans),
    ...absolute.forms,
  ];
  const invalid = numbered.invalid || absolute.invalid;
  if (forms.length > 20) return { forms: [], invalid: true };
  return { forms: forms.length === 0 ? [{ kind: "unknown" }] : forms, invalid };
}
