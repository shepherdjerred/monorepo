import { z } from "zod";
import {
  QualityRulesSchema,
  SaveQualityProfileSchema,
  type SaveQualityProfile,
} from "#shared/api.ts";
import { ResolvedProfileSchema } from "#domain/resolved-contract.ts";

/**
 * A quality profile as its form holds it, and the way there and back.
 *
 * `readProfile` turns stored rules into form state and `buildProfile` turns
 * form state into the body `POST /admin/profiles` accepts. For every profile
 * the schema allows, reading and building again gives back the same rules:
 * nothing is rounded, reordered, or dropped on the way. The tests beside
 * this file and in `testing/fixture-api` hold that.
 */

const UNITS = { B: 1, MiB: 1024 ** 2, GiB: 1024 ** 3 } as const;
export type SizeUnit = keyof typeof UNITS;
export const SIZE_UNITS: readonly SizeUnit[] = ["MiB", "GiB", "B"];

type SizeInput = { value: string; unit: SizeUnit };

/** One "this adds that many points" line. `id` only tells rows apart. */
export type ScoreRow = { id: string; key: string; score: string };

export type ProfileFormState = {
  name: string;
  /**
   * Most wanted first. The rules store the opposite order, least wanted
   * first, because a quality's rank is its position; a person ranks from
   * the top.
   */
  qualities: readonly string[];
  cutoffQuality: string;
  cutoffScore: string;
  minimumScore: string;
  minimumSize: SizeInput;
  maximumSize: SizeInput;
  rejectedCodecs: readonly string[];
  requiredAudioLanguages: readonly string[];
  tagScores: readonly ScoreRow[];
  /**
   * The profile captured from Radarr or Sonarr, as JSON text; empty when
   * the profile has none. It is the one part with no fields of its own: it
   * is a machine-made snapshot, hashed as a whole, whose custom-format
   * fields hold whatever JSON the source application wrote.
   */
  resolved: string;
};

/** Bytes in the largest unit that states them exactly in a few digits. */
function sizeInput(bytes: number): SizeInput {
  for (const unit of ["GiB", "MiB"] as const) {
    // Dividing and multiplying by a power of two is exact, so whatever is
    // shown multiplies back to the same bytes. The unit is only chosen for
    // being short to read: at most three decimal places.
    const value = bytes / UNITS[unit];
    if (bytes > 0 && Number.isInteger(value * 1000)) {
      return { value: String(value), unit };
    }
  }
  return { value: String(bytes), unit: "B" };
}

function scoreRows(scores: Readonly<Record<string, number>>): ScoreRow[] {
  return Object.entries(scores).map(([key, score], index) => ({
    id: `loaded-${String(index)}`,
    key,
    score: String(score),
  }));
}

export function blankProfile(): ProfileFormState {
  return {
    name: "",
    qualities: [],
    cutoffQuality: "",
    cutoffScore: "0",
    minimumScore: "0",
    minimumSize: { value: "", unit: "MiB" },
    maximumSize: { value: "", unit: "GiB" },
    rejectedCodecs: [],
    requiredAudioLanguages: [],
    tagScores: [],
    resolved: "",
  };
}

export type ReadProfile =
  | { kind: "editable"; state: ProfileFormState }
  /** Kept in step with the quality guide; changed only through its controls. */
  | { kind: "managed" }
  /** The stored rules are not ones this client understands. */
  | { kind: "unreadable"; problems: readonly string[] };

const RawResolvedSchema = z.looseObject({ resolved: z.json().optional() });

/**
 * Stored rules as form state. Rules the schema rejects (a field it does not
 * know, a value outside an enum) are reported, never guessed at.
 */
export function readProfile(profile: {
  name: string;
  rules: unknown;
}): ReadProfile {
  const parsed = QualityRulesSchema.safeParse(profile.rules);
  if (!parsed.success) {
    return {
      kind: "unreadable",
      problems: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "rules"}: ${issue.message}`,
      ),
    };
  }
  const rules = parsed.data;
  if (rules.managedGuide !== undefined) return { kind: "managed" };
  // As stored, not as parsed: parsing drops keys the schema does not name.
  const { resolved } = RawResolvedSchema.parse(profile.rules);
  return {
    kind: "editable",
    state: {
      name: profile.name,
      qualities: rules.qualities.toReversed(),
      cutoffQuality: rules.cutoffQuality,
      cutoffScore: String(rules.cutoffScore),
      minimumScore: String(rules.minimumScore),
      minimumSize: sizeInput(rules.minimumBytes),
      maximumSize: sizeInput(rules.maximumBytes),
      rejectedCodecs: rules.rejectedCodecs,
      requiredAudioLanguages: rules.requiredAudioLanguages,
      tagScores: scoreRows(rules.tagScores),
      resolved: resolved === undefined ? "" : JSON.stringify(resolved, null, 2),
    },
  };
}

type Problems = Record<string, string>;

function numberField(
  problems: Problems,
  field: string,
  text: string,
): number | null {
  const value = text.trim() === "" ? Number.NaN : Number(text);
  if (Number.isFinite(value)) return value;
  problems[field] = "Enter a number.";
  return null;
}

/** A size as whole bytes. A fraction of a byte is rounded to the nearest one. */
function bytesField(
  problems: Problems,
  field: string,
  size: SizeInput,
): number | null {
  const value = numberField(problems, field, size.value);
  if (value === null) return null;
  const bytes = Math.round(value * UNITS[size.unit]);
  if (bytes >= 0 && Number.isSafeInteger(bytes)) return bytes;
  problems[field] = "Enter a size of 0 or more.";
  return null;
}

function scoresField(
  problems: Problems,
  prefix: string,
  rows: readonly ScoreRow[],
): Record<string, number> {
  const seen = new Set<string>();
  const entries: [string, number][] = [];
  for (const row of rows) {
    const keyField = `${prefix}.${row.id}.key`;
    if (row.key === "") problems[keyField] = "Name what this score is for.";
    else if (seen.has(row.key)) problems[keyField] = "This is already listed.";
    seen.add(row.key);
    const score = numberField(problems, `${prefix}.${row.id}.score`, row.score);
    if (score !== null) entries.push([row.key, score]);
  }
  return Object.fromEntries(entries);
}

function resolvedField(problems: Problems, text: string): unknown {
  if (text.trim() === "") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    problems["resolved"] = "This is not valid JSON.";
    return undefined;
  }
  const checked = ResolvedProfileSchema.safeParse(value);
  if (checked.success) return value;
  const [first] = checked.error.issues;
  problems["resolved"] =
    first === undefined
      ? "This is not a captured profile."
      : `This is not a captured profile. ${first.path.join(".") || "It"}: ${first.message}`;
  return undefined;
}

/** Where a schema issue belongs, for the few the checks above cannot catch. */
const FIELD_BY_PATH: Readonly<Record<string, string>> = {
  name: "name",
  "rules.qualities": "qualities",
  "rules.cutoffQuality": "cutoffQuality",
  "rules.minimumBytes": "minimumSize",
  "rules.maximumBytes": "maximumSize",
  "rules.resolved": "resolved",
};

export type BuiltProfile =
  | { ok: true; body: SaveQualityProfile }
  /** Problems by field name. */
  | { ok: false; problems: Readonly<Record<string, string>> };

/**
 * Form state as the request body, or what is wrong with it. `identity` is
 * the profile being saved over, if any: its id and the version it had when
 * it was loaded.
 */
export function buildProfile(
  state: ProfileFormState,
  identity: { id?: string; expectedVersion: number },
): BuiltProfile {
  const problems: Problems = {};
  if (state.name.trim() === "") problems["name"] = "Give the profile a name.";
  if (state.qualities.length === 0) {
    problems["qualities"] = "Add at least one quality.";
  } else if (!state.qualities.includes(state.cutoffQuality)) {
    problems["cutoffQuality"] = "Choose one of the qualities listed above.";
  }
  const cutoffScore = numberField(problems, "cutoffScore", state.cutoffScore);
  const minimumScore = numberField(
    problems,
    "minimumScore",
    state.minimumScore,
  );
  const minimumBytes = bytesField(problems, "minimumSize", state.minimumSize);
  const maximumBytes = bytesField(problems, "maximumSize", state.maximumSize);
  if (maximumBytes === 0) {
    problems["maximumSize"] = "Enter a size above 0.";
  } else if (
    minimumBytes !== null &&
    maximumBytes !== null &&
    maximumBytes < minimumBytes
  ) {
    problems["maximumSize"] =
      "The largest file cannot be smaller than the smallest.";
  }
  const tagScores = scoresField(problems, "tagScores", state.tagScores);
  const resolved = resolvedField(problems, state.resolved);
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  const body = SaveQualityProfileSchema.safeParse({
    ...(identity.id === undefined ? {} : { id: identity.id }),
    name: state.name,
    expectedVersion: identity.expectedVersion,
    rules: {
      qualities: state.qualities.toReversed(),
      rejectedCodecs: state.rejectedCodecs,
      requiredAudioLanguages: state.requiredAudioLanguages,
      minimumBytes,
      maximumBytes,
      minimumScore,
      tagScores,
      cutoffQuality: state.cutoffQuality,
      cutoffScore,
      ...(resolved === undefined ? {} : { resolved }),
    },
  });
  if (body.success) return { ok: true, body: body.data };
  for (const issue of body.error.issues) {
    const field = FIELD_BY_PATH[issue.path.join(".")] ?? "profile";
    problems[field] ??= issue.message;
  }
  return { ok: false, problems };
}
