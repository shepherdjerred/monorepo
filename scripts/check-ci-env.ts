#!/usr/bin/env bun
/**
 * Assert every environment variable a Buildkite step's scripts REQUIRE is
 * actually provided to that step.
 *
 * The gap this closes: `buildkite-ci-secrets` reaches a step through
 * `envFrom: [{ secretRef }]`, which injects whatever keys the 1Password
 * operator synced. The cdk8s linter (`check-1password-items.ts`) only sees
 * `secretKeyRef` and volume `items[].key`, so it cannot see a single key the
 * pipeline consumes — exactly one key of that item is under its coverage today.
 * A script calling `requireEnv("CODEX_ACCESS_TOKEN")` against an item with no
 * such field therefore passed every gate and would only fail on `main`, after
 * merge, in the release step.
 *
 * The check is offline: it reads the committed vault snapshot (sha256 hashes,
 * no values) and tests membership by hashing the name the script asks for.
 *
 * Scope, deliberately narrow: only `requireEnv` imported from
 * `scripts/lib/run.ts` counts. Five unrelated `requireEnv`-shaped helpers exist
 * with different contracts, so the import is resolved rather than the name
 * grepped. Only script paths written literally in a step's command are entry
 * points — `bun run verify` fans out to per-package turbo tasks that do not
 * consume CI credentials, and following it would pull in the whole repo.
 *
 * Usage: bun scripts/check-ci-env.ts
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

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "..");
const PIPELINE_PATH = path.join(REPOSITORY_ROOT, ".buildkite", "pipeline.yml");
const SNAPSHOT_PATH = path.join(
  REPOSITORY_ROOT,
  "packages",
  "homelab",
  "src",
  "cdk8s",
  "onepassword-vault-snapshot.json",
);
/** The secret `envFrom: { secretRef: { name } }` names in every pipeline step. */
const CI_SECRET_NAME = "buildkite-ci-secrets";
/**
 * cdk8s owns which 1Password item backs that secret, so the item id is read
 * from the `OnePasswordItem` declaration rather than duplicated here — a
 * repointed itemPath then moves this check with it instead of silently
 * validating the old item.
 */
const CI_SECRET_DECLARATION = path.join(
  REPOSITORY_ROOT,
  "packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts",
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
    file: "scripts/deploy-site.ts",
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
    script: "scripts/deploy-site.ts",
    names: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
    reason:
      "The step runs deploy-site.ts with --dry-run, and both requireEnv calls " +
      "sit behind `if (!dryRun && !haveCreds)`. The live `sites` step exports " +
      "both names from the SEAWEEDFS_* secret keys and is checked normally.",
  },
  {
    step: "pr-dryrun",
    script: "scripts/scout-site-release.ts",
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
];

const SnapshotItemSchema = z.object({
  ref: z.string(),
  title: z.string(),
  fields: z.array(z.string()),
  blankFields: z.array(z.string()),
});
const SnapshotSchema = z.object({
  vaultId: z.string(),
  generatedAt: z.string(),
  items: z.array(SnapshotItemSchema),
});

export function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * The 1Password item id backing `buildkite-ci-secrets`, read from the cdk8s
 * `OnePasswordItem` that declares it. Throws rather than guessing: an
 * unreadable declaration means this check would otherwise validate against
 * the wrong item and report a clean run.
 */
export function ciSecretItemId(declarationSource: string): string {
  const anchor = declarationSource.indexOf(`"${CI_SECRET_NAME}"`);
  if (anchor === -1) {
    throw new Error(
      `no OnePasswordItem named "${CI_SECRET_NAME}" in the cdk8s declaration`,
    );
  }
  const itemPath = /vaults\/[\w-]+\/items\/([\w-]+)/u.exec(
    declarationSource.slice(anchor),
  );
  const id = itemPath?.[1];
  if (id === undefined) {
    throw new Error(
      `the "${CI_SECRET_NAME}" OnePasswordItem declares no vaults/…/items/… itemPath`,
    );
  }
  return id;
}

/**
 * Names a shell command assigns before/while running something, which the
 * secret does not carry. Steps routinely rename a secret key into the name a
 * script expects — `export AWS_ACCESS_KEY_ID="$$SEAWEEDFS_ACCESS_KEY_ID"`,
 * `export ARGOCD_TOKEN="$$ARGOCD_AUTH_TOKEN"`. Treating those as unprovided
 * would make this check's first run a wall of false positives.
 *
 * Handles several assignments per `export` (the pipeline exports the two AWS
 * names on one line) and bare `NAME=value cmd` prefixes.
 */
export function assignedEnvNames(command: string): Set<string> {
  const names = new Set<string>();
  for (const scope of commandScopes(command)) {
    for (const name of scope.assigned) names.add(name);
  }
  return names;
}

export type CommandScope = {
  /** Names assigned at or above this scope, so visible to its invocations. */
  assigned: Set<string>;
  /** Script paths invoked while those assignments are in effect. */
  scripts: string[];
};

const ASSIGNMENT = /(?<![\w$])([A-Z_][A-Z0-9_]*)=/gu;

/**
 * Split a step's command into subshell scopes.
 *
 * `pr-dryrun` exports the AWS credentials inside `( … )` around its Tofu loop
 * and then runs other scripts outside it. Treating the command as one flat
 * scope reports those names as provided to every script in the step — a false
 * negative in exactly the direction this check exists to prevent, since it
 * would let a genuinely missing credential pass.
 *
 * Only `( … )` is modelled. `{ …; }` shares the parent's environment, so it
 * needs no scope of its own, and the pipeline uses no other construct that
 * scopes exports.
 */
export function commandScopes(command: string): CommandScope[] {
  const scopes: CommandScope[] = [];
  const stack: CommandScope[] = [{ assigned: new Set(), scripts: [] }];
  scopes.push(stack[0]!);
  for (const line of command.split("\n")) {
    const trimmed = line.trim();
    const opened = (trimmed.match(/\(/gu) ?? []).length;
    const closed = (trimmed.match(/\)/gu) ?? []).length;
    // A line that opens a subshell starts a scope inheriting what is in force.
    for (let index = 0; index < opened; index += 1) {
      const parent = stack[stack.length - 1]!;
      const child: CommandScope = {
        assigned: new Set(parent.assigned),
        scripts: [],
      };
      stack.push(child);
      scopes.push(child);
    }
    const current = stack[stack.length - 1]!;
    if (/(?:^|\s|;)(?:export\s|[A-Z_][A-Z0-9_]*=)/u.test(trimmed)) {
      for (const match of trimmed.matchAll(ASSIGNMENT)) {
        const name = match[1];
        if (name !== undefined) current.assigned.add(name);
      }
    }
    current.scripts.push(...scriptPathsInCommand(trimmed));
    for (let index = 0; index < closed && stack.length > 1; index += 1) {
      stack.pop();
    }
  }
  return scopes;
}

/** Repo-relative `.ts`/`.sh` script paths written literally in a command. */
export function scriptPathsInCommand(command: string): string[] {
  const paths = new Set<string>();
  const pattern =
    /(?<![\w./-])((?:scripts|\.buildkite\/scripts|packages\/[\w.-]+(?:\/[\w.-]+)*?\/scripts)\/[\w.-]+\.ts)/gu;
  for (const match of command.matchAll(pattern)) {
    const found = match[1];
    if (found !== undefined) paths.add(found);
  }
  return [...paths].toSorted();
}

type PipelineStep = {
  key: string;
  providedNames: Set<string>;
  usesCiSecret: boolean;
  scripts: string[];
};

const StepSchema = z
  .object({
    key: z.string().optional(),
    label: z.string().optional(),
    command: z.union([z.string(), z.array(z.string())]).optional(),
    env: z.record(z.string(), z.unknown()).optional(),
    plugins: z.array(z.unknown()).optional(),
  })
  .loose();

const ContainerEnvSchema = z.object({
  env: z
    .array(z.object({ name: z.string(), value: z.string().optional() }).loose())
    .optional(),
  envFrom: z
    .array(
      z.object({ secretRef: z.object({ name: z.string() }).loose() }).loose(),
    )
    .optional(),
});
const RecordSchema = z.record(z.string(), z.unknown());

/**
 * Every `env` name and `envFrom` secret reachable anywhere inside a step. The
 * kubernetes plugin nests containers differently per anchor (`podSpec` vs
 * `podSpecPatch`), so this walks the whole subtree rather than a fixed path.
 */
function collectContainerEnv(
  node: unknown,
  names: Set<string>,
  secrets: Set<string>,
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectContainerEnv(item, names, secrets);
    return;
  }
  const record = RecordSchema.safeParse(node);
  if (!record.success) return;
  const container = ContainerEnvSchema.safeParse(record.data);
  if (container.success) {
    for (const entry of container.data.env ?? []) {
      // An explicitly empty value is not a provision: requireEnv treats "" as
      // missing and throws, so counting it would pass the check on a step
      // whose script fails at runtime. An absent `value` means `valueFrom`
      // (secret/fieldRef), which does provide one.
      if (entry.value === "") continue;
      names.add(entry.name);
    }
    for (const entry of container.data.envFrom ?? []) {
      secrets.add(entry.secretRef.name);
    }
  }
  for (const value of Object.values(record.data)) {
    collectContainerEnv(value, names, secrets);
  }
}

export function collectSteps(
  pipeline: unknown,
  globalEnvNames: readonly string[],
): PipelineStep[] {
  const document = z
    .object({
      env: z.record(z.string(), z.unknown()).optional(),
      steps: z.array(z.unknown()).optional(),
    })
    .loose()
    .parse(pipeline);
  const steps: PipelineStep[] = [];
  for (const [index, raw] of (document.steps ?? []).entries()) {
    const parsed = StepSchema.safeParse(raw);
    if (!parsed.success) continue;
    const step = parsed.data;
    const command =
      step.command === undefined
        ? ""
        : Array.isArray(step.command)
          ? step.command.join("\n")
          : step.command;
    if (command.trim() === "") continue;
    const stepNames = new Set<string>([
      ...globalEnvNames,
      // Same rule as container env: a step-level key set to an empty string
      // satisfies nothing, because requireEnv rejects "" as missing.
      ...Object.entries(step.env ?? {})
        .filter(([, value]) => value !== "")
        .map(([key]) => key),
    ]);
    const secrets = new Set<string>();
    collectContainerEnv(step.plugins, stepNames, secrets);
    const key = step.key ?? step.label ?? `step[${String(index)}]`;
    // One entry per subshell scope: a name exported inside `( … )` reaches the
    // scripts in that block and no others.
    for (const scope of commandScopes(command)) {
      if (scope.scripts.length === 0) continue;
      steps.push({
        key,
        providedNames: new Set([...stepNames, ...scope.assigned]),
        usesCiSecret: secrets.has(CI_SECRET_NAME),
        scripts: [...new Set(scope.scripts)].toSorted(),
      });
    }
  }
  return steps;
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
  secret: SecretFields,
): string | null {
  const { step, entry, name, site } = requirement;
  if (isAgentProvided(name)) return null;
  if (step.providedNames.has(name)) return null;
  const prefix = `step "${step.key}" runs ${entry}, which requires ${name} (${site})`;
  if (step.usesCiSecret && secret.hasField(name)) {
    if (!secret.isBlank(name)) return null;
    return (
      `${prefix}, but that field is BLANK on the ${CI_SECRET_NAME} 1Password item. ` +
      `The operator skips empty fields, so the variable would be missing at runtime.`
    );
  }
  return (
    `${prefix}, but the step does not provide it. Add the field to the ${CI_SECRET_NAME} ` +
    `1Password item and refresh the vault snapshot, set it in the step's env, or assign ` +
    `it in the step's command.`
  );
}

function errorsForInvocation(
  invocation: {
    step: PipelineStep;
    entry: string;
    required: RequiredEnv;
  },
  secret: SecretFields,
  exceptionsByFile: ReadonlyMap<string, DynamicCallException>,
): string[] {
  const { step, entry, required } = invocation;
  const errors: string[] = [];
  for (const site of required.unresolved) {
    const file = site.slice(0, site.lastIndexOf(":"));
    if (exceptionsByFile.has(file)) continue;
    errors.push(
      `step "${step.key}" runs ${entry}, whose requireEnv at ${site} is not a string literal. ` +
        `Add an exception to DYNAMIC_CALL_EXCEPTIONS in scripts/check-ci-env.ts declaring the names it may require.`,
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
    const unmet = unmetRequirement({ step, entry, name, site }, secret);
    if (unmet !== null) errors.push(unmet);
  }
  return errors;
}

export function collectErrors(input: {
  steps: readonly PipelineStep[];
  secret: SecretFields;
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
          input.secret,
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

async function main(): Promise<void> {
  let steps: PipelineStep[];
  let secret: SecretFields;
  try {
    const pipeline: unknown = parse(await Bun.file(PIPELINE_PATH).text(), {
      merge: true,
    });
    const globalEnv = z
      .object({ env: z.record(z.string(), z.unknown()).optional() })
      .loose()
      .parse(pipeline);
    steps = collectSteps(pipeline, Object.keys(globalEnv.env ?? {}));
  } catch (error: unknown) {
    fail(
      `check-ci-env: could not read ${path.relative(REPOSITORY_ROOT, PIPELINE_PATH)}: ${String(error)}`,
      2,
    );
  }
  try {
    const snapshot = SnapshotSchema.parse(await Bun.file(SNAPSHOT_PATH).json());
    const itemId = ciSecretItemId(await Bun.file(CI_SECRET_DECLARATION).text());
    const item = snapshot.items.find((entry) => entry.ref === hash(itemId));
    if (item === undefined) {
      fail(
        `check-ci-env: the ${CI_SECRET_NAME} item is absent from the vault snapshot. Refresh it with ` +
          `packages/homelab/src/cdk8s/scripts/snapshot-1password-vault.ts.`,
        2,
      );
    }
    const fields = new Set(item.fields);
    const blanks = new Set(item.blankFields);
    secret = {
      hasField: (name: string) => fields.has(hash(name)),
      isBlank: (name: string) => blanks.has(hash(name)),
    };
  } catch (error: unknown) {
    fail(
      `check-ci-env: could not read the vault snapshot: ${String(error)}`,
      2,
    );
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

  const errors = collectErrors({ steps, secret, requiredFor });
  if (errors.length > 0) {
    for (const error of errors) console.error(`✗ ${error}`);
    fail(
      `check-ci-env: ${String(errors.length)} unmet CI environment requirement(s).`,
      1,
    );
  }
  const checked = steps.reduce((total, step) => total + step.scripts.length, 0);
  console.log(
    `check-ci-env: OK — ${String(steps.length)} pipeline step(s), ${String(checked)} script invocation(s) verified against the ${CI_SECRET_NAME} snapshot.`,
  );
}

if (import.meta.main) {
  await main();
}
