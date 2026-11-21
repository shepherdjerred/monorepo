import {
  ProviderSeedingPolicySchema,
  SaveProviderSchema,
  type ProviderStatus,
  type SaveProvider,
} from "#shared/admin.ts";

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
function seedingPolicyInput(form: FormData): unknown {
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
    minimumSeconds: optionalNumber(form, "policySeconds"),
    combination: text(form, "policyCombination").trim(),
    sizeRule:
      form.get("policySizeRule") === "on"
        ? {
            secondsPerGiB: Number(text(form, "policySecondsPerGiB").trim()),
            minimumSeconds: Number(text(form, "policySizeMinimum").trim()),
            maximumSeconds: optionalNumber(form, "policySizeMaximum"),
          }
        : null,
  };
}

export function readSeedingPolicy(form: FormData) {
  return ProviderSeedingPolicySchema.parse(seedingPolicyInput(form));
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
  const parsed = SaveProviderSchema.safeParse({
    expectedUpdatedAt: provider.updatedAt,
    enabled: form.get("enabled") === "on",
    configuration: {
      ...provider.configuration,
      minimumIntervalSeconds: Number(text(form, "minimumIntervalSeconds")),
      dailyDownloadLimit: Number(text(form, "dailyDownloadLimit")),
    },
    seedingPolicy: seedingPolicyInput(form),
    ...(credential === undefined ? {} : { credential }),
  });
  if (parsed.success) return { ok: true, input: parsed.data };
  const fields: Record<string, string> = {};
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
