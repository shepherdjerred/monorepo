import {
  ProviderSeedingPolicySchema,
  SaveProviderSchema,
  type ProviderStatus,
  type SaveProvider,
} from "#shared/admin.ts";
import {
  EVERY_DURATION_UNIT,
  readDuration,
  type DurationRules,
} from "#client/ui/forms/duration.ts";

/**
 * Reads a provider's form into the body `PUT /admin/providers/:id` accepts.
 * The controls are named here and read by name, so the payload does not
 * depend on how the form is laid out.
 */

/** The credential each provider signs in with, in the order it is asked for. */
export const CREDENTIAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  privatehd: ["username", "password", "pid"],
  avistaz: ["username", "password", "pid"],
  animez: ["username", "password", "pid"],
  opensubtitles: ["apiKey", "userAgent", "username", "password"],
  assrt: ["token"],
  subhd: ["baseUrl", "token", "instanceId"],
};

/**
 * The form's lengths of time, by control name. The API takes each in
 * seconds; the limits here are the schema's, so a field can say what is
 * wrong in the unit it was typed in.
 */
export const DURATION_RULES = {
  minimumIntervalSeconds: {
    units: ["seconds", "minutes"],
    startUnit: "seconds",
    min: 1,
    max: 3600,
  },
  policySeconds: { units: EVERY_DURATION_UNIT, startUnit: "days", min: 1 },
  // The one time the API takes a fraction of a second for.
  policySecondsPerGiB: {
    units: EVERY_DURATION_UNIT,
    startUnit: "hours",
    min: 0.001,
    fractional: true,
  },
  policySizeMinimum: { units: EVERY_DURATION_UNIT, startUnit: "hours", min: 0 },
  policySizeMaximum: { units: EVERY_DURATION_UNIT, startUnit: "days", min: 1 },
} as const satisfies Record<string, DurationRules>;

type DurationName = keyof typeof DURATION_RULES;
/** A duration field in seconds; `null` when it was left empty. */
type ReadSeconds = (name: DurationName) => number | null;

/**
 * Reads duration fields in seconds and keeps what is wrong with each. One
 * that cannot be read comes back as `NaN`, which no schema accepts.
 */
function durationReader(form: FormData) {
  const problems: Record<string, string> = {};
  const seconds: ReadSeconds = (name) => {
    const parsed = readDuration(form, name, DURATION_RULES[name]);
    if (parsed.ok) return parsed.seconds;
    problems[name] = parsed.message;
    return Number.NaN;
  };
  return { problems, seconds };
}

function text(form: FormData, name: string): string {
  const field = form.get(name);
  if (typeof field !== "string") throw new TypeError(`Missing ${name}`);
  return field;
}

function optionalNumber(form: FormData, name: string): number | null {
  const field = text(form, name).trim();
  return field === "" ? null : Number(field);
}

/** The seeding policy as the form states it, before the schema has checked it. */
function seedingPolicyInput(form: FormData, seconds: ReadSeconds): unknown {
  const kind = text(form, "policyKind").trim();
  if (kind === "unknown" || kind === "public") return { kind };
  const common = {
    kind,
    verified: form.get("policyVerified") === "on",
    evidence: text(form, "policyEvidence").trim(),
    ratio: optionalNumber(form, "policyRatio"),
  };
  if (kind === "privatehd") return common;
  return {
    ...common,
    minimumSeconds: seconds("policySeconds"),
    combination: text(form, "policyCombination").trim(),
    sizeRule:
      form.get("policySizeRule") === "on"
        ? {
            secondsPerGiB: seconds("policySecondsPerGiB"),
            minimumSeconds: seconds("policySizeMinimum"),
            maximumSeconds: seconds("policySizeMaximum"),
          }
        : null,
  };
}

export function readSeedingPolicy(form: FormData) {
  return ProviderSeedingPolicySchema.parse(
    seedingPolicyInput(form, durationReader(form).seconds),
  );
}

/** Which control a schema issue belongs to, by the issue's path. */
const FIELD_BY_PATH: Readonly<Record<string, string>> = {
  "configuration.minimumIntervalSeconds": "minimumIntervalSeconds",
  "configuration.dailyDownloadLimit": "dailyDownloadLimit",
  seedingPolicy: "policyVerified",
  "seedingPolicy.kind": "policyKind",
  "seedingPolicy.evidence": "policyEvidence",
  "seedingPolicy.ratio": "policyRatio",
  "seedingPolicy.minimumSeconds": "policySeconds",
  "seedingPolicy.combination": "policyCombination",
  "seedingPolicy.sizeRule.secondsPerGiB": "policySecondsPerGiB",
  "seedingPolicy.sizeRule.minimumSeconds": "policySizeMinimum",
  "seedingPolicy.sizeRule.maximumSeconds": "policySizeMaximum",
};

/** The schema's own wording, where a person needs something plainer. */
const PLAIN_MESSAGES: Readonly<Record<string, string>> = {
  "Maximum size-rule duration must not be below its minimum":
    "The longest time cannot be shorter than the shortest time.",
  "A verified private policy needs at least one obligation":
    "Rules you have checked need a ratio, a minimum time, or a size-based time.",
};

export type ProviderInput =
  | { ok: true; input: SaveProvider }
  /** `fields` are problems by control name; `other` could not be placed. */
  | { ok: false; fields: Readonly<Record<string, string>>; other: boolean };

export function readProvider(
  form: FormData,
  provider: ProviderStatus,
): ProviderInput {
  const credentialFields = CREDENTIAL_FIELDS[provider.id] ?? [];
  const credential =
    form.get("replaceCredential") === "on"
      ? Object.fromEntries(
          credentialFields.map((field) => [
            field,
            text(form, `credential.${field}`),
          ]),
        )
      : undefined;
  const durations = durationReader(form);
  const parsed = SaveProviderSchema.safeParse({
    expectedUpdatedAt: provider.updatedAt,
    enabled: form.get("enabled") === "on",
    configuration: {
      ...provider.configuration,
      minimumIntervalSeconds: durations.seconds("minimumIntervalSeconds"),
      dailyDownloadLimit: Number(text(form, "dailyDownloadLimit")),
    },
    seedingPolicy: seedingPolicyInput(form, durations.seconds),
    ...(credential === undefined ? {} : { credential }),
  });
  if (parsed.success) return { ok: true, input: parsed.data };
  // A time that could not be read says so better than the schema does.
  const fields: Record<string, string> = { ...durations.problems };
  let other = false;
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".");
    const name =
      FIELD_BY_PATH[path] ??
      (issue.path[0] === "credential" && issue.path.length === 2
        ? `credential.${String(issue.path[1])}`
        : undefined);
    if (name === undefined) other = true;
    else fields[name] ??= PLAIN_MESSAGES[issue.message] ?? issue.message;
  }
  return { ok: false, fields, other };
}
