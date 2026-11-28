#!/usr/bin/env bun

import {
  optionalEnv,
  requireEnv,
  run,
  runAllowExit,
  tmpBase,
  type RunOptions,
} from "@shepherdjerred/root-scripts/lib/run.ts";
import {
  isTransientError,
  runMain,
} from "@shepherdjerred/root-scripts/lib/transient.ts";
import { TransientError } from "@shepherdjerred/root-scripts/lib/transient-error.ts";
import type { TofuStack } from "@shepherdjerred/ops-model/platform-policy.ts";
import {
  loadPlatformDesiredState,
  type PlatformStack,
} from "#scripts/platform-desired-state.ts";
import {
  parseTofuStack,
  STACK_MANIFEST,
  STATE_CREDENTIALS,
  type StackDefinition,
} from "./tofu-stack-manifest.ts";
import { assertApplicationSecretAction } from "./application-secrets.ts";
import { adoptApplicationSecrets } from "./adopt-application-secrets.ts";
import { assertSynthesizedStack } from "./tofu-external-files.ts";
import { prepareAsuswrtProvider } from "./asuswrt-provider.ts";
import {
  assertStackExecutionContext,
  runDockerTokenStack,
  type TofuAction,
} from "./dockerhub-tokens.ts";
import { runServiceAccountPlan } from "./tofu-service-account.ts";

const STACKS_REL = "src/tofu";

const AMBIENT_ENV_ALLOWLIST = [
  "CI",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LC_ALL",
  "NO_PROXY",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TF_IN_AUTOMATION",
  "TF_PLUGIN_CACHE_DIR",
  "TMPDIR",
  "TOFU_VALIDATION_PLUGIN_CACHE_DIR",
  "USER",
] as const;

function homelabRoot(): string {
  return new URL("../..", import.meta.url).pathname;
}

function ambientEnvironment(): Record<string, string> {
  return Object.fromEntries(
    AMBIENT_ENV_ALLOWLIST.flatMap((name) => {
      const value = optionalEnv(name);
      return value === null ? [] : [[name, value] as const];
    }),
  );
}

export function buildTofuEnvironment(
  stack: TofuStack,
  read: (name: string) => string = requireEnv,
): Record<string, string> {
  const definition = STACK_MANIFEST[stack];
  const env = ambientEnvironment();
  delete env["TOFU_VALIDATION_PLUGIN_CACHE_DIR"];
  for (const { source, target } of [
    ...STATE_CREDENTIALS,
    ...definition.credentials,
  ]) {
    env[target] = read(source);
  }
  if (stack === "dockerhub-tokens") {
    const username = optionalEnv("DOCKER_USERNAME");
    const password = optionalEnv("DOCKER_PASSWORD");
    if ((username === null) !== (password === null)) {
      throw new Error(
        "Docker account authentication requires both DOCKER_USERNAME and DOCKER_PASSWORD, or neither for the native credential store.",
      );
    }
    if (username !== null && password !== null) {
      env["DOCKER_USERNAME"] = username;
      env["DOCKER_PASSWORD"] = password;
    }
  }
  if (definition.secretObject !== undefined) {
    env[definition.secretObject.target] = JSON.stringify(
      Object.fromEntries(
        Object.entries(definition.secretObject.entries).map(
          ([name, source]) => [name, read(source)],
        ),
      ),
    );
  }
  if (stack === "seaweedfs") {
    env["AWS_DEFAULT_REGION"] = "us-east-1";
    env["AWS_REQUEST_CHECKSUM_CALCULATION"] = "WHEN_REQUIRED";
    env["AWS_RESPONSE_CHECKSUM_VALIDATION"] = "WHEN_REQUIRED";
  }
  return env;
}

export function desiredStateVariableValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function addDesiredStateEnvironment(
  stackDir: string,
  platform: PlatformStack,
  env: Record<string, string>,
): Promise<void> {
  const desiredState = await loadPlatformDesiredState(stackDir, platform);
  for (const [name, value] of Object.entries(desiredState)) {
    env[`TF_VAR_${name}`] = desiredStateVariableValue(value);
  }
}

function isolatedOptions(
  env: Record<string, string>,
  cwd?: string,
): RunOptions {
  return cwd === undefined
    ? { env, inheritEnv: false }
    : { cwd, env, inheritEnv: false };
}

async function temporaryDirectory(
  prefix: string,
  env: Record<string, string>,
): Promise<string> {
  const result = await run(
    ["mktemp", "-d", `${tmpBase()}/${prefix}.XXXXXXXX`],
    {
      ...isolatedOptions(env),
      capture: true,
      echoCapturedStdout: false,
    },
  );
  const directory = result.stdout.trim();
  if (directory === "")
    throw new Error(`mktemp returned no path for ${prefix}`);
  return directory;
}

export async function validationEnvironment(
  definition: StackDefinition,
): Promise<{ env: Record<string, string>; dataRoot: string }> {
  const env = ambientEnvironment();
  delete env["TF_PLUGIN_CACHE_DIR"];
  const validationPluginCacheDir = env["TOFU_VALIDATION_PLUGIN_CACHE_DIR"];
  delete env["TOFU_VALIDATION_PLUGIN_CACHE_DIR"];
  if (
    validationPluginCacheDir !== undefined &&
    validationPluginCacheDir !== "" &&
    definition.localProvider === undefined
  ) {
    env["TF_PLUGIN_CACHE_DIR"] = validationPluginCacheDir;
  }
  const dataRoot = await temporaryDirectory("tofu-validation", env);
  env["TF_DATA_DIR"] = dataRoot;
  if (definition.encrypted === true) {
    env["TF_VAR_tofu_state_encryption_passphrase"] =
      "ci-validation-only-passphrase";
  }
  if (definition.validationPassphraseVariable !== undefined) {
    env[`TF_VAR_${definition.validationPassphraseVariable}`] =
      "ci-validation-only-passphrase";
  }
  if (definition.secretObject !== undefined) {
    env[definition.secretObject.target] = JSON.stringify(
      Object.fromEntries(
        Object.keys(definition.secretObject.entries).map((name) => [
          name,
          "ci-validation-only-token",
        ]),
      ),
    );
  }
  if (definition.platform === "openai") {
    env["TF_VAR_openai_certificate_values"] = "{}";
  }
  return { env, dataRoot };
}

async function removeTemporaryDirectory(directory: string): Promise<void> {
  await run(
    ["rm", "-rf", "--", directory],
    isolatedOptions(ambientEnvironment()),
  );
}

export function validationInitArguments(stack: TofuStack): string[] {
  const argumentsList = [
    "tofu",
    `-chdir=${STACKS_REL}/${stack}`,
    "init",
    "-backend=false",
    "-reconfigure",
  ];
  if (STACK_MANIFEST[stack].localProvider === undefined) {
    argumentsList.push("-lockfile=readonly");
  }
  argumentsList.push("-input=false");
  return argumentsList;
}

async function validateStack(
  stack: TofuStack,
  root: string,
  stackDir: string,
): Promise<void> {
  const definition = STACK_MANIFEST[stack];
  const { env, dataRoot } = await validationEnvironment(definition);
  if (definition.platform !== undefined) {
    await addDesiredStateEnvironment(stackDir, definition.platform, env);
  }
  let localProviderRoot: string | null = null;
  try {
    if (definition.localProvider === "asuswrt") {
      localProviderRoot = await prepareAsuswrtProvider(env);
    }
    const options = isolatedOptions(env, root);
    await run(validationInitArguments(stack), options);
    await run(["tofu", `-chdir=${STACKS_REL}/${stack}`, "validate"], options);
  } finally {
    if (localProviderRoot !== null) {
      await removeTemporaryDirectory(localProviderRoot);
    }
    await removeTemporaryDirectory(dataRoot);
  }
}

function usage(): never {
  console.error(
    [
      "Usage: bun packages/homelab/scripts/tofu/tofu-stack.ts <stack> validate|plan|apply [--dry-run]",
      "  plan flags: [--service-account] [--expect-no-changes]",
      "    --service-account     Resolve homelab-vault op:// references from deliveryTofuGrants(stack)",
      "                          via scripts/onepassword/with-service-account.sh (automatic and",
      "                          reviewed-plan stacks; operator-only stacks anthropic-federation,",
      "                          argocd, asuswrt, backblaze, dockerhub-tokens, google, and",
      "                          application-secrets require desktop or operator credentials).",
      "    --expect-no-changes   Fail with a non-zero exit when tofu plan detects changes (exit 2).",
      "Application adoption: application-secrets adopt EXPECTED_HEAD",
    ].join("\n"),
  );
  process.exit(1);
}

function parseAction(value: string | undefined): TofuAction {
  return value === "validate" || value === "plan" || value === "apply"
    ? value
    : usage();
}

export type TofuStackFlags = {
  dryRun: boolean;
  expectNoChanges: boolean;
  serviceAccount: boolean;
};

export function parseTofuStackFlags(
  rawFlags: readonly string[],
  action: TofuAction,
): TofuStackFlags {
  let dryRun = false;
  let expectNoChanges = false;
  let serviceAccount = false;
  for (const flag of rawFlags) {
    switch (flag) {
      case "--dry-run":
        dryRun = true;
        break;
      case "--expect-no-changes":
        expectNoChanges = true;
        break;
      case "--service-account":
        serviceAccount = true;
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }
  if (expectNoChanges && action !== "plan") {
    throw new Error(
      "--expect-no-changes is only supported with the plan action.",
    );
  }
  if (serviceAccount && action !== "plan") {
    throw new Error(
      "--service-account is only supported with the plan action.",
    );
  }
  return { dryRun, expectNoChanges, serviceAccount };
}

export function interpretPlanExit(
  stack: TofuStack,
  definition: StackDefinition,
  result: { exitCode: number; stderr: string },
  expectNoChanges = false,
): void {
  if (result.exitCode === 0) {
    console.log("No changes.");
    return;
  }
  if (result.exitCode === 2) {
    console.log("Changes detected.");
    if (expectNoChanges) {
      throw new Error(
        `tofu plan detected changes for ${stack} (--expect-no-changes)`,
      );
    }
    return;
  }
  const message = `tofu plan failed (exit ${result.exitCode.toString()})`;
  if (definition.platform === undefined && isTransientError(result.stderr)) {
    throw new TransientError(message);
  }
  throw new Error(message);
}

async function runPlanAction(options: {
  stack: TofuStack;
  definition: StackDefinition;
  root: string;
  env: Record<string, string>;
  expectNoChanges: boolean;
}): Promise<void> {
  const dataRoot = await temporaryDirectory("tofu-plan", options.env);
  options.env["TF_DATA_DIR"] = dataRoot;
  try {
    const runOpts = isolatedOptions(options.env, options.root);
    await run(
      ["tofu", `-chdir=${STACKS_REL}/${options.stack}`, "init", "-input=false"],
      runOpts,
    );
    const result = await runAllowExit(
      [
        "tofu",
        `-chdir=${STACKS_REL}/${options.stack}`,
        "plan",
        "-input=false",
        "-detailed-exitcode",
      ],
      runOpts,
    );
    interpretPlanExit(
      options.stack,
      options.definition,
      result,
      options.expectNoChanges,
    );
  } finally {
    await removeTemporaryDirectory(dataRoot);
  }
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage();
  const positional = args.filter((argument) => !argument.startsWith("--"));
  const rawFlags = args.filter((argument) => argument.startsWith("--"));
  const stackName = positional[0];
  if (stackName === undefined) usage();
  const stack = parseTofuStack(stackName);
  if (stack === "application-secrets" && positional[1] === "adopt") {
    return adoptApplicationSecrets(args);
  }
  if (positional.length > 2) usage();
  const action = parseAction(positional[1]);
  const flags = parseTofuStackFlags(rawFlags, action);
  assertStackExecutionContext(stack, action, Bun.env["CI"]);
  if (stack === "application-secrets") assertApplicationSecretAction(action);
  const root = homelabRoot();
  const stackDir = `${root}/${STACKS_REL}/${stack}`;
  await assertSynthesizedStack(stack, stackDir);
  if (flags.serviceAccount) {
    return runServiceAccountPlan({
      stack,
      root,
      scriptPath: new URL(import.meta.url).pathname,
      dryRun: flags.dryRun,
      expectNoChanges: flags.expectNoChanges,
    });
  }
  if (flags.dryRun) {
    console.log(`DRYRUN: would run tofu ${action} for ${stack}`);
    return;
  }
  if (action === "validate") {
    await validateStack(stack, root, stackDir);
    console.log(`--- validated: ${stack}`);
    return;
  }
  const definition = STACK_MANIFEST[stack];
  const env = buildTofuEnvironment(stack);
  if (definition.platform !== undefined) {
    await addDesiredStateEnvironment(stackDir, definition.platform, env);
  }
  if (stack === "dockerhub-tokens") {
    return runDockerTokenStack(action, root, env, {
      expectNoChanges: flags.expectNoChanges,
    });
  }
  if (action === "plan") {
    return runPlanAction({
      stack,
      definition,
      root,
      env,
      expectNoChanges: flags.expectNoChanges,
    });
  }
  const options = isolatedOptions(env, root);
  await run(
    ["tofu", `-chdir=${STACKS_REL}/${stack}`, "init", "-input=false"],
    options,
  );
  await run(
    [
      "tofu",
      `-chdir=${STACKS_REL}/${stack}`,
      "apply",
      "-auto-approve",
      "-input=false",
    ],
    options,
  );
  console.log(`--- applied: ${stack}`);
}

if (import.meta.main) await runMain(main);
