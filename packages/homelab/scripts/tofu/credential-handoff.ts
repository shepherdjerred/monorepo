import { z } from "zod";
import {
  loadPlatformDesiredState,
  collectOnePasswordTargets,
} from "#scripts/platform-desired-state.ts";
import {
  applicationSecrets,
  applicationTargets,
  CredentialTargetSchema,
  type CredentialTarget,
} from "./application-secrets.ts";
import {
  capturedRead,
  parseHandoffCliInvocation,
  parsePrivateJson,
  readVault,
  resolveItemTargetValue,
  targetKey,
  validateDeclaredHandoffs,
  type HandoffStack,
} from "./secret-read.ts";
import { writeSecretTargets, type SecretFieldWrite } from "./secret-write.ts";
import { resolveAuditItem } from "#cdk8s/scripts/onepassword/field-map.ts";
import type { OpItem } from "#cdk8s/scripts/onepassword-lib.ts";
import { STATE_CREDENTIALS } from "./tofu-stack-manifest.ts";

export function targetValue(
  items: readonly OpItem[],
  target: CredentialTarget,
): string | undefined {
  return resolveItemTargetValue(items, target);
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
      if (complete && !equal) {
        reasons.push(
          "targets contain different values; retain both and investigate identity",
        );
      }
      if (
        equal &&
        values[0] !== undefined &&
        !/^[\u{20}-\u{7E}]+$/u.test(values[0])
      ) {
        reasons.push(
          "import profile requires a separate provider compatibility review",
        );
      }
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

function matchStatus(actual: string | undefined, expected: string): string {
  if (actual === undefined) return "unresolved";
  return actual === expected ? "matches" : "differs";
}

export function verifyHandoffs(
  raw: unknown,
  allowed: readonly CredentialTarget[],
  items: readonly OpItem[],
  owners?: ReadonlyMap<string, string>,
) {
  return validateDeclaredHandoffs(raw, allowed, owners).map((entry) => ({
    unit: entry.unit,
    target: entry.target,
    status: matchStatus(targetValue(items, entry.target), entry.value),
    supersedes_id: entry.supersedes_id,
  }));
}

export function selectHandoffWrites(
  raw: unknown,
  allowed: readonly CredentialTarget[],
  owners?: ReadonlyMap<string, string>,
  requestedUnits?: readonly string[],
): SecretFieldWrite[] {
  const entries = validateDeclaredHandoffs(raw, allowed, owners);
  if (requestedUnits === undefined || requestedUnits.length === 0) {
    return entries.map(({ unit, target, value }) => ({ unit, target, value }));
  }
  const availableUnits = new Set(entries.map((entry) => entry.unit));
  const selectedSet = new Set<string>();
  for (const unit of requestedUnits) {
    if (!availableUnits.has(unit))
      throw new Error(`Unknown handoff unit: ${unit}`);
    selectedSet.add(unit);
  }
  return entries
    .filter((entry) => selectedSet.has(entry.unit))
    .map(({ unit, target, value }) => ({ unit, target, value }));
}

export function handoffEnvironment(
  read: (name: string) => string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of "PATH HOME HTTPS_PROXY HTTP_PROXY NO_PROXY SSL_CERT_FILE SSL_CERT_DIR".split(
    " ",
  )) {
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
      Object.entries(applicationSecrets.credentials).flatMap(([unit, cred]) =>
        cred.onepassword_targets.map((target) => [targetKey(target), unit]),
      ),
    );
  }
  const parsed = z.record(z.string(), z.unknown()).parse(desired);
  const owners = new Map<string, string>();
  for (const name of [
    "credentials",
    "openai_service_accounts",
    "cloudflare_api_tokens",
  ]) {
    const resources = z.record(z.string(), z.unknown()).safeParse(parsed[name]);
    if (!resources.success) continue;
    for (const [unit, resource] of Object.entries(resources.data)) {
      for (const ref of collectOnePasswordTargets(resource)) {
        const key = targetKey(CredentialTargetSchema.parse(ref));
        if (owners.has(key))
          throw new Error("Desired-state target has conflicting owners.");
        owners.set(key, unit);
      }
    }
  }
  return owners;
}

export const R2_S3_CREDENTIAL_FIELDS = {
  "s3-access-key-id": "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "s3-secret-access-key": "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
} as const;

export function handoffDesiredState(desired: unknown, stack: string): unknown {
  if (stack !== "cloudflare-tokens") return desired;
  const parsed = z
    .looseObject({
      cloudflare_api_tokens: z.record(
        z.string(),
        z.looseObject({
          managed: z.boolean().default(true),
          s3_credential: z.boolean().optional(),
          vault_item_id: z.string().min(1),
        }),
      ),
    })
    .parse(desired);
  const managed = Object.entries(parsed.cloudflare_api_tokens).filter(
    ([, token]) => token.managed,
  );
  const tokens: Record<string, unknown> = Object.fromEntries(managed);
  for (const [name, token] of managed) {
    if (token.s3_credential !== true) continue;
    for (const [unit, field] of Object.entries(R2_S3_CREDENTIAL_FIELDS)) {
      tokens[`${name}.${unit}`] = {
        vault_item_id: token.vault_item_id,
        vault_field: field,
      };
    }
  }
  return { ...parsed, cloudflare_api_tokens: tokens };
}

const OWNED_SOURCE_PATHS = [
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "tsconfig.base.json",
  "packages/homelab/package.json",
  "packages/homelab/tsconfig.json",
  "packages/homelab/tsconfig.scripts.json",
  "packages/homelab/src/cdk8s/package.json",
  "packages/homelab/src/cdk8s/tsconfig.json",
  "scripts/onepassword",
  "packages/homelab/src/delivery-platform-grants.ts",
  "packages/homelab/src/tofu",
  "packages/homelab/scripts/tofu",
  "packages/homelab/scripts/platform-desired-state.ts",
  "packages/homelab/src/cdk8s/scripts/onepassword",
  "packages/homelab/src/cdk8s/scripts/onepassword-lib.ts",
];
const IGNORED_ADOPTION_GLOBS = [
  ":(top,glob)packages/homelab/src/tofu/application-secrets/terraform.tfvars*",
  ":(top,glob)packages/homelab/src/tofu/application-secrets/*.auto.tfvars*",
  ":(top,glob)packages/homelab/src/tofu/application-secrets/*.tf",
  ":(top,glob)packages/homelab/src/tofu/application-secrets/*.tf.json",
  ":(top,glob)packages/homelab/src/tofu/application-secrets/*.tofu",
  ":(top,glob)packages/homelab/src/tofu/application-secrets/*.tofu.json",
];

export async function assertCleanHandoffSource(
  read: typeof capturedRead = capturedRead,
): Promise<void> {
  const dirty = await read(
    ["git", "status", "--porcelain", "--", ...OWNED_SOURCE_PATHS],
    "source status",
  );
  if (dirty.trim() !== "") {
    throw new Error(
      "Verify requires clean owning source; preview remains available.",
    );
  }
  const ignored = await read(
    [
      "git",
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--",
      ...IGNORED_ADOPTION_GLOBS,
    ],
    "ignored adoption inputs",
  );
  if (ignored.trim() !== "")
    throw new Error("Uncommitted autoloaded adoption inputs are not allowed.");
}

async function loadStackTargetsAndDesired(stack: HandoffStack) {
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
      : collectOnePasswordTargets(desired).map((t) =>
          CredentialTargetSchema.parse(t),
        );
  return { desired, targets };
}

async function runPreview(stack: HandoffStack, head: string): Promise<void> {
  const items = await readVault();
  if (stack === "application-secrets") {
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
  const { targets } = await loadStackTargetsAndDesired(stack);
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
}

export async function main(args: string[]): Promise<void> {
  const { stack, action, expectedHead, dryRun, requestedUnits } =
    parseHandoffCliInvocation(args);
  const headRaw = await capturedRead(
    ["git", "rev-parse", "HEAD"],
    "source revision",
  );
  const head = headRaw.trim();
  if (action === "preview") {
    await runPreview(stack, head);
    return;
  }
  if (expectedHead !== head || !/^[a-f0-9]{40}$/u.test(expectedHead)) {
    throw new Error(
      action === "verify"
        ? "Verify requires the current expected source revision as the third argument."
        : "Apply requires the current expected source revision as the third argument.",
    );
  }
  await assertCleanHandoffSource();

  const { desired, targets } = await loadStackTargetsAndDesired(stack);
  const outputName = {
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
        outputName,
      ],
      "encrypted handoff output",
      env,
    ),
    z.unknown(),
  );
  const owners = targetOwners(desired, stack);

  if (action === "apply" || action === "write") {
    const writes = selectHandoffWrites(raw, targets, owners, requestedUnits);
    const results = await writeSecretTargets(writes, { dryRun });
    const selectedUnits = [
      ...new Set(writes.flatMap((w) => (w.unit === undefined ? [] : [w.unit]))),
    ];
    console.log(
      JSON.stringify(
        {
          source_revision: head,
          action,
          dry_run: dryRun,
          selected_units: selectedUnits,
          results,
          prerequisites: [
            "wait for 1Password Connect to refresh the Kubernetes Secret and restart consumers",
            "consumer probe before revoking superseded credentials",
          ],
        },
        null,
        2,
      ),
    );
    return;
  }

  const items = await readVault();
  console.log(
    JSON.stringify(
      {
        source_revision: head,
        state_revision_proven: false,
        results: verifyHandoffs(raw, targets, items, owners),
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
