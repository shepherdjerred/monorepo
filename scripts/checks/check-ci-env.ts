#!/usr/bin/env bun
/**
 * Enforce the Buildkite credential contract end to end.
 *
 * Every command step must use the unprivileged service account, disable its
 * Kubernetes API token, and receive exactly the secretKeyRef grants declared
 * in `.buildkite/secret-grants.json`. The check also proves each granted key is
 * present and non-blank in the committed hashed 1Password snapshot, then
 * verifies that every statically reachable `requireEnv` is satisfied.
 *
 * Scope, deliberately narrow: only `requireEnv` imported from
 * `scripts/lib/run.ts` counts. Five unrelated `requireEnv`-shaped helpers exist
 * with different contracts, so the import is resolved rather than the name
 * grepped. Only script paths written literally in a step's command are entry
 * points — `bun run verify` fans out to per-package turbo tasks that do not
 * consume CI credentials, and following it would pull in the whole repo.
 *
 * Usage: bun scripts/checks/check-ci-env.ts
 *
 * Exit codes:
 *   0 - every required variable is provided
 *   1 - a required variable is missing/blank, or a requireEnv call could not be
 *       resolved statically and has no exception
 *   2 - setup error (pipeline or snapshot unreadable)
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { parse } from "yaml";
import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import { z } from "zod";
import { collectSteps, type PipelineStep } from "../lib/ci-env-pipeline.ts";
import {
  collectSteps as collectGrantSteps,
  compareStepGrants,
} from "../lib/ci-secret-grant-pipeline.ts";
import {
  declaredSecretItems,
  parseSecretGrantManifest,
  parseVaultSnapshot,
  validateGrantCatalog,
  type SecretGrantManifest,
  type VaultSnapshot,
} from "../lib/ci-secret-grant-schema.ts";

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "..", "..");
const MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  ".buildkite/secret-grants.json",
);
const SNAPSHOT_PATH = path.join(
  REPOSITORY_ROOT,
  "packages",
  "homelab",
  "src",
  "cdk8s",
  "onepassword-vault-snapshot.json",
);
/**
 * cdk8s owns which 1Password item backs that secret, so the item id is read
 * from the `OnePasswordItem` declaration rather than duplicated here — a
 * repointed itemPath then moves this check with it instead of silently
 * validating the old item.
 */
const CI_SECRET_DECLARATION = path.join(
  REPOSITORY_ROOT,
  "packages/homelab/src/cdk8s/src/resources/argo-applications/ci/buildkite.ts",
);
/** The only `requireEnv` whose contract this check models. */
const REQUIRE_ENV_MODULE = path.join(
  REPOSITORY_ROOT,
  "scripts",
  "lib",
  "run.ts",
);

/**
 * Names the Buildkite agent injects into every step. They are never carried by
 * the secret and never assigned in a command, so without this they would all
 * read as missing.
 */
const AGENT_PROVIDED_PREFIXES = ["BUILDKITE_", "CI_"] as const;
const AGENT_PROVIDED_NAMES = new Set([
  "CI",
  "PATH",
  "HOME",
  "TMPDIR",
  "GITHUB_REPOSITORY",
]);

/**
 * Call sites whose `requireEnv` argument is not a string literal. Each entry
 * must say why the names cannot be read statically and declare the names the
 * site may require, so coverage is preserved rather than dropped.
 */
const DYNAMIC_CALL_EXCEPTIONS: readonly {
  file: string;
  reason: string;
  names: readonly string[];
}[] = [
  {
    file: "scripts/release/deploy-site.ts",
    reason:
      "requireEnv(name) iterates DEPLOY_SITES[].buildEnvVars. No site in the " +
      "catalog declares buildEnvVars today, so the loop requires nothing. If a " +
      "site adds one, list its names here so they are checked again.",
    names: [],
  },
];

/**
 * Requirements a step provably does not hit. This analysis is flow-insensitive
 * — it unions every `requireEnv` in a script's import graph regardless of the
 * branch it sits in — so a requirement gated behind a flag the step passes has
 * to be declared here rather than inferred.
 */
const STEP_REQUIREMENT_EXCEPTIONS: readonly {
  step: string;
  script: string;
  names: readonly string[];
  reason: string;
}[] = [
  {
    step: "pr-dryrun",
    script: "packages/homelab/scripts/tofu-stack.ts",
    names: ["POSTHOG_CLI_API_KEY", "POSTHOG_TOFU_STATE_PASSPHRASE"],
    reason:
      "The shared PR Tofu pod plans only seaweedfs, tailscale, buildkite, arr, " +
      "github, and cloudflare. posthog has its own credential-isolated plan pod.",
  },
  {
    step: "tofu-apply",
    script: "packages/homelab/scripts/tofu-stack.ts",
    names: ["POSTHOG_CLI_API_KEY", "POSTHOG_TOFU_STATE_PASSPHRASE"],
    reason:
      "The infra-state apply loop excludes posthog, which has a dedicated " +
      "credential-isolated main apply lane.",
  },
  {
    step: "tofu-github",
    script: "packages/homelab/scripts/tofu-stack.ts",
    names: ["POSTHOG_CLI_API_KEY", "POSTHOG_TOFU_STATE_PASSPHRASE"],
    reason: "This lane invokes only the github stack.",
  },
  {
    step: "tofu-cloudflare",
    script: "packages/homelab/scripts/tofu-stack.ts",
    names: ["POSTHOG_CLI_API_KEY", "POSTHOG_TOFU_STATE_PASSPHRASE"],
    reason: "This lane invokes only the cloudflare stack.",
  },
  {
    step: "tofu-posthog-plan",
    script: "packages/homelab/scripts/tofu-stack.ts",
    names: [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "POSTHOG_CLI_API_KEY",
      "POSTHOG_TOFU_STATE_PASSPHRASE",
    ],
    reason:
      "PR validation uses backend-free OpenTofu with a placeholder; main alone gets credentials.",
  },
  {
    step: "pr-dryrun",
    script: "scripts/release/deploy-site.ts",
    names: [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "CLOUDFLARE_ACCOUNT_ID",
    ],
    reason:
      "The step runs deploy-site.ts with --dry-run, which does not create the " +
      "R2 client or require its AWS and Cloudflare configuration. The live " +
      "sites step receives those credentials and is checked normally.",
  },
  {
    step: "pr-dryrun",
    script: "scripts/release/scout-site-release.ts",
    names: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
    reason:
      "Same shape via scripts/lib/scout-site-storage.ts's requireCreds(dryRun): " +
      "every subcommand this step runs passes --dry-run. The live " +
      "scout-beta-release step exports both names and is checked normally.",
  },
  {
    step: "pr-dryrun",
    script: "packages/homelab/scripts/argocd.ts",
    names: ["ARGOCD_TOKEN"],
    reason:
      "The step runs every argocd.ts subcommand with --dry-run, and each " +
      "ARGOCD_TOKEN requirement sits behind an `if (!dryRun)` guard — the " +
      "script's own header documents it as 'required unless --dry-run'. The " +
      "steps that call argocd.ts for real (argocd-sync, tofu-cloudflare) " +
      "export ARGOCD_TOKEN in their command and are checked normally.",
  },
  {
    step: "pr-dryrun",
    script: "scripts/release/release.ts",
    names: [
      "OPENROUTER_API_KEY",
      "GITHUB_APP_ID",
      "GITHUB_APP_INSTALLATION_ID",
      "GITHUB_APP_PRIVATE_KEY",
    ],
    reason:
      "The step runs release.ts with --dry-run, which returns before provider " +
      "inference, GitHub App authentication, and the OpenRouter credential " +
      "preflight. The release-please step supplies them and is checked normally.",
  },
  {
    step: "pr-dryrun",
    script: "scripts/release/update-versions.ts",
    names: [
      "GITHUB_APP_ID",
      "GITHUB_APP_INSTALLATION_ID",
      "GITHUB_APP_PRIVATE_KEY",
    ],
    reason:
      "The step passes --dry-run, so update-versions validates candidates " +
      "without authenticating as the GitHub App or writing a commit.",
  },
];

export function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type RequiredEnv = {
  /** Env var name → the `file:line` that requires it. */
  names: Map<string, string>;
  /** `file:line` of calls whose argument is not a string literal. */
  unresolved: string[];
};

/**
 * Whether this file imports `requireEnv` from `scripts/lib/run.ts`. Resolving
 * the import is the point: `packages/toolkit/src/lib/config.ts`,
 * `activities/gcx-context.ts`, `activities/glitter-corpus-store.ts` and
 * `llm-observability/src/config.ts` all export a differently-shaped helper of
 * the same or a similar name, and none of them is fed by the CI secret.
 */
function importsOurRequireEnv(source: SourceFile): boolean {
  for (const declaration of source.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (!specifier.startsWith(".")) continue;
    const resolved = path.resolve(
      path.dirname(source.getFilePath()),
      specifier,
    );
    if (resolved !== REQUIRE_ENV_MODULE) continue;
    for (const named of declaration.getNamedImports()) {
      if (named.getName() === "requireEnv") return true;
    }
  }
  return false;
}

/**
 * Union of `requireEnv` names reachable from `entry` through relative imports.
 * Package-alias imports are not followed: the graph that matters here is the
 * root scripts tree plus each package's own scripts directory, which import
 * `lib/run.ts` by relative path.
 */
export function requiredEnvFrom(project: Project, entry: string): RequiredEnv {
  const accumulated: RequiredEnv = { names: new Map(), unresolved: [] };
  const seen = new Set<string>();

  const visit = (relativePath: string): void => {
    const absolute = path.resolve(REPOSITORY_ROOT, relativePath);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    const source = project.addSourceFileAtPathIfExists(absolute);
    if (source === undefined) return;

    if (importsOurRequireEnv(source)) {
      const relative = path.relative(REPOSITORY_ROOT, source.getFilePath());
      for (const call of source.getDescendantsOfKind(
        SyntaxKind.CallExpression,
      )) {
        if (call.getExpression().getText() !== "requireEnv") continue;
        const site = `${relative}:${String(call.getStartLineNumber())}`;
        const literal = call
          .getArguments()[0]
          ?.asKind(SyntaxKind.StringLiteral);
        if (literal === undefined) accumulated.unresolved.push(site);
        else accumulated.names.set(literal.getLiteralValue(), site);
      }
    }

    for (const declaration of source.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(
        path.dirname(source.getFilePath()),
        specifier,
      );
      visit(path.relative(REPOSITORY_ROOT, resolved));
    }
  };

  visit(entry);
  return accumulated;
}

function isAgentProvided(name: string): boolean {
  return (
    AGENT_PROVIDED_NAMES.has(name) ||
    AGENT_PROVIDED_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/**
 * Membership predicates rather than a name set: the snapshot stores sha256
 * hashes and never plaintext, so the only possible question is "is the name
 * this script asked for present/blank?", answered by hashing the candidate.
 */
export type SecretFields = {
  hasField: (name: string) => boolean;
  isBlank: (name: string) => boolean;
};

export type DynamicCallException = {
  file: string;
  reason: string;
  names: readonly string[];
};

/** Why `name` is unsatisfied for this step, or null when it is satisfied. */
function unmetRequirement(
  requirement: {
    step: PipelineStep;
    entry: string;
    name: string;
    site: string;
  },
  explicitSecrets: ReadonlyMap<string, SecretFields>,
): string | null {
  const { step, entry, name, site } = requirement;
  if (isAgentProvided(name)) return null;
  if (step.providedNames.has(name)) return null;
  const prefix = `step "${step.key}" runs ${entry}, which requires ${name} (${site})`;
  const explicitRef = step.explicitSecretRefs?.get(name);
  if (explicitRef !== undefined) {
    const referencedSecret = explicitSecrets.get(explicitRef.secretName);
    if (referencedSecret === undefined) {
      return (
        `${prefix}, but its secretKeyRef names ${explicitRef.secretName}, which has no ` +
        `OnePasswordItem declaration backed by the vault snapshot.`
      );
    }
    if (!referencedSecret.hasField(explicitRef.key)) {
      return (
        `${prefix}, but ${explicitRef.secretName} does not contain key ${explicitRef.key} ` +
        `in its declared 1Password item. Refresh the vault snapshot after adding it.`
      );
    }
    if (referencedSecret.isBlank(explicitRef.key)) {
      return (
        `${prefix}, but ${explicitRef.secretName} key ${explicitRef.key} is BLANK ` +
        `in its declared 1Password item. The operator skips empty fields, so the ` +
        `variable would be missing at runtime.`
      );
    }
    return null;
  }
  return (
    `${prefix}, but the step does not provide it through explicit env, a ` +
    `validated secretKeyRef, or a command assignment.`
  );
}

function errorsForInvocation(
  invocation: {
    step: PipelineStep;
    entry: string;
    required: RequiredEnv;
  },
  explicitSecrets: ReadonlyMap<string, SecretFields>,
  exceptionsByFile: ReadonlyMap<string, DynamicCallException>,
): string[] {
  const { step, entry, required } = invocation;
  const errors: string[] = [];
  for (const site of required.unresolved) {
    const file = site.slice(0, site.lastIndexOf(":"));
    if (exceptionsByFile.has(file)) continue;
    errors.push(
      `step "${step.key}" runs ${entry}, whose requireEnv at ${site} is not a string literal. ` +
        `Add an exception to DYNAMIC_CALL_EXCEPTIONS in scripts/checks/check-ci-env.ts declaring the names it may require.`,
    );
  }
  const names = new Map(required.names);
  // Only THIS script's exception contributes. Applying every exception's
  // declared names to every script would make one entry's names required of
  // unrelated scripts in unrelated steps — currently latent because the sole
  // entry declares none, which is exactly how it would go unnoticed.
  for (const name of exceptionsByFile.get(entry)?.names ?? []) {
    names.set(name, `${entry} (declared exception)`);
  }
  const excepted = new Set(
    STEP_REQUIREMENT_EXCEPTIONS.filter(
      (exception) => exception.step === step.key && exception.script === entry,
    ).flatMap((exception) => [...exception.names]),
  );
  for (const [name, site] of names) {
    if (excepted.has(name)) continue;
    const unmet = unmetRequirement(
      { step, entry, name, site },
      explicitSecrets,
    );
    if (unmet !== null) errors.push(unmet);
  }
  return errors;
}

export function collectErrors(input: {
  steps: readonly PipelineStep[];
  /** Secrets addressed through explicit Kubernetes secretKeyRefs. */
  explicitSecrets?: ReadonlyMap<string, SecretFields>;
  requiredFor: (entry: string) => RequiredEnv;
  /** Defaults to the declared table; injected by tests. */
  dynamicCallExceptions?: readonly DynamicCallException[];
}): string[] {
  const exceptionsByFile = new Map(
    (input.dynamicCallExceptions ?? DYNAMIC_CALL_EXCEPTIONS).map((entry) => [
      entry.file,
      entry,
    ]),
  );
  const errors: string[] = [];
  for (const step of input.steps) {
    for (const entry of step.scripts) {
      errors.push(
        ...errorsForInvocation(
          { step, entry, required: input.requiredFor(entry) },
          input.explicitSecrets ?? new Map(),
          exceptionsByFile,
        ),
      );
    }
  }
  return [...new Set(errors)].toSorted();
}

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

function secretFields(
  snapshot: VaultSnapshot,
  itemId: string,
): SecretFields | undefined {
  const item = snapshot.items.find((entry) => entry.ref === hash(itemId));
  if (item === undefined) return undefined;
  const fields = new Set(item.fields);
  const blanks = new Set(item.blankFields);
  return {
    hasField: (name: string) => fields.has(hash(name)),
    isBlank: (name: string) => blanks.has(hash(name)),
  };
}

async function readPipeline(pipelinePath: string): Promise<unknown> {
  try {
    return parse(
      await Bun.file(path.join(REPOSITORY_ROOT, pipelinePath)).text(),
      { merge: true, maxAliasCount: -1 },
    );
  } catch (error: unknown) {
    fail(`check-ci-env: could not read ${pipelinePath}: ${String(error)}`, 2);
  }
}

async function readCredentialInputs(): Promise<{
  manifest: SecretGrantManifest;
  snapshot: VaultSnapshot;
  declarations: string;
}> {
  try {
    return {
      manifest: parseSecretGrantManifest(await Bun.file(MANIFEST_PATH).json()),
      snapshot: parseVaultSnapshot(await Bun.file(SNAPSHOT_PATH).json()),
      declarations: await Bun.file(CI_SECRET_DECLARATION).text(),
    };
  } catch (error: unknown) {
    fail(
      `check-ci-env: invalid grant manifest, vault snapshot, or cdk8s declaration: ${String(error)}`,
      2,
    );
  }
}

async function main(): Promise<void> {
  const { manifest, snapshot, declarations } = await readCredentialInputs();
  const errors = validateGrantCatalog({
    manifest,
    snapshot,
    declarationSource: declarations,
  });
  const declaredItems = declaredSecretItems(declarations);
  const explicitSecrets = new Map<string, SecretFields>();
  for (const [secretName, itemId] of declaredItems) {
    const fields = secretFields(snapshot, itemId);
    if (fields !== undefined) explicitSecrets.set(secretName, fields);
  }
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false },
  });
  const cache = new Map<string, RequiredEnv>();
  const requiredFor = (entry: string): RequiredEnv => {
    const cached = cache.get(entry);
    if (cached !== undefined) return cached;
    const computed = requiredEnvFrom(project, entry);
    cache.set(entry, computed);
    return computed;
  };

  const requirementSteps: PipelineStep[] = [];
  let grantStepCount = 0;
  let grantCount = 0;
  for (const [pipelinePath, expected] of Object.entries(manifest.pipelines)) {
    const pipeline = await readPipeline(pipelinePath);
    const globalEnv = z
      .object({ env: z.record(z.string(), z.unknown()).optional() })
      .loose()
      .parse(pipeline);
    const globalEnvNames = Object.keys(globalEnv.env ?? {});
    const grantSteps = collectGrantSteps(pipeline, globalEnvNames);
    errors.push(
      ...grantSteps.errors.map((error) => `${pipelinePath}: ${error}`),
      ...compareStepGrants(grantSteps.steps, expected).map(
        (error) => `${pipelinePath}: ${error}`,
      ),
    );
    grantStepCount += grantSteps.steps.length;
    grantCount += grantSteps.steps.reduce(
      (total, step) => total + step.grants.length,
      0,
    );
    requirementSteps.push(...collectSteps(pipeline, globalEnvNames));
  }
  errors.push(
    ...collectErrors({
      steps: requirementSteps,
      explicitSecrets,
      requiredFor,
    }),
  );
  if (errors.length > 0) {
    const uniqueErrors = [...new Set(errors)].toSorted();
    for (const error of uniqueErrors) console.error(`✗ ${error}`);
    fail(
      `check-ci-env: ${String(uniqueErrors.length)} credential contract violation(s).`,
      1,
    );
  }
  const checked = requirementSteps.reduce(
    (total, step) => total + step.scripts.length,
    0,
  );
  console.log(
    `check-ci-env: OK — ${String(grantStepCount)} steps, ${String(grantCount)} exact grants, and ${String(checked)} script invocations verified.`,
  );
}

if (import.meta.main) {
  await main();
}
