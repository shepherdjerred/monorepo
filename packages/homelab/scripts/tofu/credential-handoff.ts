import { z } from "zod";
import {
  loadPlatformDesiredState,
  collectOnePasswordTargets,
} from "#scripts/platform-desired-state.ts";
import {
  applicationSecrets,
  applicationTargets,
  assertPreparationAction,
  CredentialTargetSchema,
  jsonCredential,
  type CredentialTarget,
} from "./application-secrets.ts";
import { capturedRead, parsePrivateJson, readVault } from "./secret-read.ts";
import { resolveAuditItem } from "#cdk8s/scripts/onepassword/field-map.ts";
import type { OpItem } from "#cdk8s/scripts/onepassword-lib.ts";
import { STATE_CREDENTIALS } from "./tofu-stack-manifest.ts";

export function targetValue(
  items: readonly OpItem[],
  target: CredentialTarget,
): string | undefined {
  const item = resolveAuditItem(items, target.vault_item_id);
  if (item === undefined) return undefined;
  const fields = (item.fields ?? []).filter(
    (field) =>
      target.vault_field === (field.label ?? field.id) &&
      field.section?.id === target.vault_section_id &&
      (target.vault_field_id === undefined ||
        field.id === target.vault_field_id),
  );
  if (
    fields.length !== 1 ||
    fields[0]?.value === undefined ||
    fields[0].value === ""
  )
    return undefined;
  return target.vault_json_path === undefined
    ? fields[0].value
    : jsonCredential(fields[0].value, target.vault_json_path);
}

export function previewAdoption(items: readonly OpItem[]) {
  return Object.entries(applicationSecrets.credentials).map(
    ([key, credential]) => {
      const values = credential.onepassword_targets.map((target) =>
        targetValue(items, target),
      );
      const complete = values.every((value) => value !== undefined);
      const equal = complete && values.every((value) => value === values[0]);
      const reasons: string[] = [];
      if (!complete)
        reasons.push("missing, blank, ambiguous or unsupported section field");
      if (complete && !equal)
        reasons.push(
          "targets contain different values; retain both and investigate identity",
        );
      if (key === "chartmuseum") {
        const server = targetValue(items, {
          vault_item_id: "wwoism5fsvmbisv4ef47yxqy2i",
          vault_field: "username",
        });
        const ci = targetValue(items, {
          vault_item_id: "cnutkdwa7uka5hk3wx5gimyfom",
          vault_field: "CHARTMUSEUM_USERNAME",
        });
        if (server === undefined || ci === undefined || server !== ci)
          reasons.push("ChartMuseum account identity differs or is unresolved");
      }
      // The import profile uses byte lengths. Its ASCII contract is exercised
      // with both short and >72-byte values against the pinned provider.
      if (
        equal &&
        values[0] !== undefined &&
        !/^[\u{20}-\u{7E}]+$/u.test(values[0])
      )
        reasons.push(
          "import profile requires a separate provider compatibility review",
        );
      return {
        key,
        revision: credential.revision,
        environment: credential.environment,
        targets: credential.onepassword_targets.map((target) => ({
          ...target,
          resolved_item_id:
            resolveAuditItem(items, target.vault_item_id)?.id ?? null,
          item_version:
            resolveAuditItem(items, target.vault_item_id)?.version ?? null,
        })),
        status:
          reasons.length === 0
            ? "preserve-value-adoption-candidate"
            : "blocked",
        adoption_length:
          reasons.length === 0 ? (values[0]?.length ?? null) : null,
        reasons,
        consumer_probe: credential.consumer_probe,
        prerequisites: [
          "unique stack state passphrase enrolled in 1Password",
          "operator authorization for encrypted import",
          "zero replacement plan",
          "field and whole-item ownership review",
        ],
      };
    },
  );
}

const HandoffTargetSchema = z
  .object({
    vault_item_id: z.string().min(1),
    vault_field: z.string().min(1),
    vault_section_id: z.string().optional(),
    vault_field_id: z.string().optional(),
    vault_json_path: z.string().nullish(),
  })
  .transform(
    ({
      vault_item_id: itemId,
      vault_field: field,
      vault_json_path: jsonPath,
      vault_section_id: sectionId,
      vault_field_id: fieldId,
    }): CredentialTarget => ({
      vault_item_id: itemId,
      vault_field: field,
      ...(jsonPath == null ? {} : { vault_json_path: jsonPath }),
      ...(sectionId === undefined ? {} : { vault_section_id: sectionId }),
      ...(fieldId === undefined ? {} : { vault_field_id: fieldId }),
    }),
  );
const HandoffUnitSchema = z.object({
  value: z.string().min(1).optional(),
  api_key: z.string().min(1).optional(),
  api_token: z.string().min(1).optional(),
  onepassword_targets: z.array(HandoffTargetSchema).optional(),
  vault_item_id: z.string().optional(),
  vault_field: z.string().optional(),
  vault_json_path: z.string().nullish(),
  supersedes_id: z.string().nullable().optional(),
});
const HandoffSchema = z.record(z.string(), HandoffUnitSchema);

function targetKey(target: CredentialTarget): string {
  return JSON.stringify([
    target.vault_item_id,
    target.vault_field,
    target.vault_json_path ?? null,
    ...(target.vault_section_id === undefined &&
    target.vault_field_id === undefined
      ? []
      : [target.vault_section_id ?? null, target.vault_field_id ?? null]),
  ]);
}

function handoffTargets(
  handoff: z.infer<typeof HandoffUnitSchema>,
): CredentialTarget[] {
  if (handoff.onepassword_targets !== undefined)
    return handoff.onepassword_targets;
  if (handoff.vault_item_id === undefined || handoff.vault_field === undefined)
    return [];
  const target: CredentialTarget = {
    vault_item_id: handoff.vault_item_id,
    vault_field: handoff.vault_field,
  };
  if (handoff.vault_json_path != null)
    target.vault_json_path = handoff.vault_json_path;
  return [target];
}

function matchStatus(actual: string | undefined, expected: string): string {
  if (actual === undefined) return "unresolved";
  return actual === expected ? "matches" : "differs";
}

/** Verify exact declared targets; values and provider response details never escape. */
export function verifyHandoffs(
  raw: unknown,
  allowed: readonly CredentialTarget[],
  items: readonly OpItem[],
  owners?: ReadonlyMap<string, string>,
) {
  const parsed = HandoffSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error("Malformed sensitive handoff; details withheld.");
  const declared = new Set(allowed.map((target) => targetKey(target)));
  const visited = new Set<string>();
  const report = [];
  for (const [unit, handoff] of Object.entries(parsed.data)) {
    const value = handoff.value ?? handoff.api_key ?? handoff.api_token;
    const targets = handoffTargets(handoff);
    if (value === undefined || targets.length === 0)
      throw new Error(
        "Handoff value or targets are missing; details withheld.",
      );
    for (const target of targets) {
      const key = targetKey(target);
      if (!declared.has(key) || visited.has(key))
        throw new Error(
          "Handoff target is undeclared or has conflicting owners.",
        );
      if (owners !== undefined && owners.get(key) !== unit)
        throw new Error("Handoff unit does not own this target.");
      visited.add(key);
      const actual = targetValue(items, target);
      report.push({
        unit,
        target,
        status: matchStatus(actual, value),
        supersedes_id: handoff.supersedes_id ?? null,
      });
    }
  }
  if (visited.size !== declared.size)
    throw new Error("Handoff does not cover every declared target.");
  return report;
}

/** The output reader needs state access, never provider admin or vault-write credentials. */
export function handoffEnvironment(
  read: (name: string) => string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [
    "PATH",
    "HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ]) {
    const value = Bun.env[name];
    if (value !== undefined) env[name] = value;
  }
  for (const { source, target } of STATE_CREDENTIALS)
    env[target] = read(source);
  env["TF_VAR_tofu_state_encryption_passphrase"] = read(
    "TOFU_STATE_ENCRYPTION_PASSPHRASE",
  );
  return env;
}

function targetOwners(desired: unknown, stack: string): Map<string, string> {
  if (stack === "application-secrets") {
    return new Map(
      Object.entries(applicationSecrets.credentials).flatMap(
        ([unit, credential]) =>
          credential.onepassword_targets.map((target) => [
            targetKey(target),
            unit,
          ]),
      ),
    );
  }
  const parsed = z.record(z.string(), z.unknown()).parse(desired);
  const resourceMaps = [
    "credentials",
    "openai_service_accounts",
    "cloudflare_api_tokens",
  ];
  const owners = new Map<string, string>();
  for (const name of resourceMaps) {
    const resources = z.record(z.string(), z.unknown()).safeParse(parsed[name]);
    if (!resources.success) continue;
    for (const [unit, resource] of Object.entries(resources.data)) {
      for (const ref of collectOnePasswordTargets(resource)) {
        const target = CredentialTargetSchema.parse(ref);
        const key = targetKey(target);
        if (owners.has(key))
          throw new Error("Desired-state target has conflicting owners.");
        owners.set(key, unit);
      }
    }
  }
  return owners;
}

/** Cloudflare emits sensitive handoffs only for generated, managed tokens. */
export function handoffDesiredState(desired: unknown, stack: string): unknown {
  if (stack !== "cloudflare-tokens") return desired;
  const parsed = z
    .looseObject({
      cloudflare_api_tokens: z.record(
        z.string(),
        z.looseObject({ managed: z.boolean() }),
      ),
    })
    .parse(desired);
  return {
    ...parsed,
    cloudflare_api_tokens: Object.fromEntries(
      Object.entries(parsed.cloudflare_api_tokens).filter(
        ([, token]) => token.managed,
      ),
    ),
  };
}

export async function main(args: string[]): Promise<void> {
  const [stack, action, expectedHead] = args;
  assertPreparationAction(action ?? "");
  if (
    stack !== "openai" &&
    stack !== "cloudflare-tokens" &&
    stack !== "application-secrets"
  )
    throw new Error("Choose openai, cloudflare-tokens or application-secrets.");
  const headOutput = await capturedRead(
    ["git", "rev-parse", "HEAD"],
    "source revision",
  );
  const head = headOutput.trim();
  if (
    action === "verify" &&
    (expectedHead !== head || !/^[a-f0-9]{40}$/u.test(expectedHead))
  )
    throw new Error(
      "Verify requires the current expected source revision as the third argument.",
    );
  const items = await readVault();
  if (stack === "application-secrets" && action === "preview") {
    console.log(
      JSON.stringify(
        {
          source_revision: head,
          bootstrap: {
            proposed_item_title: "application-secrets-tofu-credentials",
            field: "TOFU_STATE_ENCRYPTION_PASSPHRASE",
            status: "prepare-only; create separately after review",
          },
          units: previewAdoption(items),
        },
        null,
        2,
      ),
    );
    return;
  }
  const desired = handoffDesiredState(
    stack === "application-secrets"
      ? applicationSecrets
      : await loadPlatformDesiredState(
          new URL(`../../src/tofu/${stack}/`, import.meta.url).pathname,
          stack,
        ),
    stack,
  );
  const targets =
    stack === "application-secrets"
      ? applicationTargets
      : collectOnePasswordTargets(desired).map((target) =>
          CredentialTargetSchema.parse(target),
        );
  if (action === "preview") {
    console.log(
      JSON.stringify(
        {
          source_revision: head,
          targets: targets.map((target) => ({
            target,
            exists: targetValue(items, target) !== undefined,
          })),
          output_read: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  const dirty = await capturedRead(
    [
      "git",
      "status",
      "--porcelain",
      "--",
      "packages/homelab/src/tofu",
      "packages/homelab/scripts/tofu",
      "packages/homelab/scripts/platform-desired-state.ts",
      "packages/homelab/src/cdk8s/scripts/onepassword",
      "packages/homelab/src/cdk8s/scripts/onepassword-lib.ts",
    ],
    "source status",
  );
  if (dirty.trim() !== "")
    throw new Error(
      "Verify requires clean owning source; preview remains available.",
    );
  const output = {
    openai: "openai_service_account_handoffs",
    "cloudflare-tokens": "cloudflare_api_token_handoffs",
    "application-secrets": "application_secret_handoffs",
  }[stack];
  const env = handoffEnvironment((name) => {
    const value = Bun.env[name];
    if (value === undefined || value === "")
      throw new Error(`Missing credential environment variable: ${name}`);
    return value;
  });
  const raw = parsePrivateJson(
    await capturedRead(
      [
        "tofu",
        `-chdir=packages/homelab/src/tofu/${stack}`,
        "output",
        "-json",
        output,
      ],
      "encrypted handoff output",
      env,
    ),
    z.unknown(),
  );
  console.log(
    JSON.stringify(
      {
        source_revision: head,
        state_revision_proven: false,
        results: verifyHandoffs(
          raw,
          targets,
          items,
          targetOwners(desired, stack),
        ),
        prerequisites: [
          "confirm state was applied from this revision",
          "consumer probe before revoking superseded credentials",
        ],
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  try {
    await main(Bun.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Handoff preparation failed; details withheld.",
    );
    process.exitCode = 1;
  }
}
