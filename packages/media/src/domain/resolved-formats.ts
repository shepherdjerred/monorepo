import type {
  FormatSpecification,
  Match,
  RegexMatcher,
  ResolvedProfile,
  ResolvedRelease,
  SourceQuality,
} from "./resolved-contract.ts";
import {
  canonicalLanguage,
  originalAudioPresence,
} from "./quality-guide/language.ts";

const SOURCES = {
  radarr: [
    "unknown",
    "cam",
    "telesync",
    "telecine",
    "workprint",
    "dvd",
    "tv",
    "webdl",
    "webrip",
    "bluray",
  ],
  sonarr: [
    "unknown",
    "television",
    "televisionraw",
    "web",
    "webrip",
    "dvd",
    "bluray",
    "blurayraw",
  ],
};
const MODIFIERS = ["none", "regional", "screener", "rawhd", "brdisk", "remux"];
export const SUPPORTED_SPECIFICATIONS = new Set([
  "ReleaseTitleSpecification",
  "ReleaseGroupSpecification",
  "SourceSpecification",
  "QualityModifierSpecification",
  "ResolutionSpecification",
  "LanguageSpecification",
]);

function or(matches: Match[]): Match {
  if (matches.includes("match")) return "match";
  return matches.includes("unknown") ? "unknown" : "no_match";
}
function textMatch(
  pattern: string,
  value: string | null,
  matcher: RegexMatcher,
): Match {
  return value === null ? "unknown" : matcher(pattern, value);
}
function numericMatch(expected: unknown, actual: number | undefined): Match {
  if (typeof expected !== "number" || actual === undefined || actual < 0)
    return "unknown";
  return actual === expected ? "match" : "no_match";
}
function originalLanguageMatch(
  release: ResolvedRelease,
  provisional: boolean,
): Match {
  if (
    release.originalLanguage === null ||
    canonicalLanguage(release.originalLanguage) === null
  )
    return "unknown";
  const presence = originalAudioPresence(
    release.originalLanguage,
    release.audioLanguages,
  );
  if (presence === "unknown") return provisional ? "match" : "unknown";
  return presence === "present" ? "match" : "no_match";
}
function matchValue(
  spec: FormatSpecification,
  release: ResolvedRelease,
  quality: SourceQuality,
  context: {
    profile: ResolvedProfile;
    matcher: RegexMatcher;
    phase: "listing" | "measured";
  },
): Match {
  const { profile, matcher } = context;
  const field = spec.fields[0];
  if (spec.fields.length !== 1 || field?.name !== "value") return "unknown";
  const value = field.value;
  switch (spec.implementation) {
    case "ReleaseTitleSpecification":
      return typeof value === "string"
        ? or([
            textMatch(value, release.releaseTitle, matcher),
            textMatch(value, release.filename, matcher),
          ])
        : "unknown";
    case "ReleaseGroupSpecification":
      return typeof value === "string"
        ? textMatch(value, release.releaseGroup, matcher)
        : "unknown";
    case "SourceSpecification":
      return numericMatch(
        value,
        SOURCES[profile.source].indexOf(quality.source.toLowerCase()),
      );
    case "QualityModifierSpecification":
      return profile.source === "radarr" && quality.modifier !== undefined
        ? numericMatch(value, MODIFIERS.indexOf(quality.modifier.toLowerCase()))
        : "unknown";
    case "ResolutionSpecification":
      return numericMatch(value, quality.resolution);
    case "LanguageSpecification": {
      // The selected guide uses only Original (-2). Other Arr language IDs
      // require an explicit catalog and are never guessed from their names.
      return value === -2
        ? originalLanguageMatch(
            release,
            context.phase === "listing" &&
              profile.householdPolicy?.provisionalUnknownListingAudio === true,
          )
        : "unknown";
    }
    default:
      return "unknown";
  }
}
function specificationMatch(
  spec: FormatSpecification,
  release: ResolvedRelease,
  quality: SourceQuality,
  context: {
    profile: ResolvedProfile;
    matcher: RegexMatcher;
    phase: "listing" | "measured";
  },
): Match {
  const result = matchValue(spec, release, quality, context);
  if (result === "unknown" || !spec.negate) return result;
  return result === "match" ? "no_match" : "match";
}

/** Types are ANDed; within each type, all required rules AND at least one rule must match. */
function groupMatch(results: { required: boolean; result: Match }[]): Match {
  if (results.some((item) => item.required && item.result === "no_match"))
    return "no_match";
  if (results.every((item) => item.result === "no_match")) return "no_match";
  return results.some((item) => item.required && item.result === "unknown")
    ? "unknown"
    : or(results.map((item) => item.result));
}
export function calculateResolvedScore(
  profile: ResolvedProfile,
  release: ResolvedRelease,
  quality: SourceQuality,
  matching:
    RegexMatcher | { matcher: RegexMatcher; phase: "listing" | "measured" },
): { score: number; matched: number[]; unknown: number[] } {
  const { matcher, phase } =
    typeof matching === "function"
      ? { matcher: matching, phase: "measured" as const }
      : matching;
  let score = 0;
  const matched: number[] = [];
  const unknown: number[] = [];
  for (const scoreItem of profile.profile.formatItems) {
    // Unscored formats cannot alter acceptance, cutoff or upgrade decisions.
    if (scoreItem.score === 0) continue;
    const format = profile.customFormats.find(
      (item) => item.id === scoreItem.format,
    );
    if (format === undefined)
      throw new Error("Resolved profile references a missing custom format");
    const groups = Map.groupBy(
      format.specifications,
      (spec) => spec.implementation,
    );
    const results = new Set(
      [...groups.values()].map((specs) =>
        groupMatch(
          specs.map((spec) => ({
            required: spec.required,
            result: specificationMatch(spec, release, quality, {
              profile,
              matcher,
              phase,
            }),
          })),
        ),
      ),
    );
    if (results.has("no_match")) continue;
    if (results.has("unknown")) unknown.push(format.id);
    else {
      matched.push(format.id);
      score += scoreItem.score;
    }
  }
  return { score, matched, unknown };
}
