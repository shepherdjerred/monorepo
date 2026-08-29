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
import {
  loadPlatformDesiredState,
  type PlatformStack,
} from "./platform-desired-state.ts";
import {
  parseTofuStack,
  STACK_MANIFEST,
  STATE_CREDENTIALS,
  type StackDefinition,
  type TofuStack,
} from "./tofu-stack-manifest.ts";

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
  "USER",
] as const;

type TofuAction = "validate" | "plan" | "apply";

function homelabRoot(): string {
  return new URL("..", import.meta.url).pathname;
}

function ambientEnvironment(): Record<string, string> {
  const entries = AMBIENT_ENV_ALLOWLIST.flatMap((name) => {
    const value = optionalEnv(name);
    return value === null ? [] : [[name, value] as const];
  });
  return Object.fromEntries(entries);
}

export function buildTofuEnvironment(
  stack: TofuStack,
  read: (name: string) => string = requireEnv,
): Record<string, string> {
  const definition = STACK_MANIFEST[stack];
  const env = ambientEnvironment();
  for (const { source, target } of [
    ...STATE_CREDENTIALS,
    ...definition.credentials,
  ]) {
    env[target] = read(source);
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

async function addDesiredStateEnvironment(
  stackDir: string,
  platform: PlatformStack,
  env: Record<string, string>,
): Promise<Record<string, unknown>> {
  const desiredState = await loadPlatformDesiredState(stackDir, platform);
  for (const [name, value] of Object.entries(desiredState)) {
    env[`TF_VAR_${name}`] = JSON.stringify(value);
  }
  return desiredState;
}

export function addValidationOnlySecrets(
  platform: PlatformStack,
  desiredState: Readonly<Record<string, unknown>>,
  env: Record<string, string>,
): void {
  if (platform !== "openrouter") return;
  const credentials = desiredState["openrouter_byok_credentials"];
  if (
    typeof credentials !== "object" ||
    credentials === null ||
    Array.isArray(credentials)
  ) {
    throw new TypeError(
      "openrouter_byok_credentials must be an object after desired-state validation",
    );
  }
  env["TF_VAR_openrouter_byok_keys"] = JSON.stringify(
    Object.fromEntries(
      Object.keys(credentials).map((name) => [
        name,
        "ci-validation-only-provider-key",
      ]),
    ),
  );
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
  const path = result.stdout.trim();
  if (path === "") throw new Error(`mktemp returned no path for ${prefix}`);
  return path;
}

async function validationEnvironment(definition: StackDefinition): Promise<{
  env: Record<string, string>;
  dataRoot: string;
}> {
  const env = ambientEnvironment();
  const dataRoot = await temporaryDirectory("tofu-validation", env);
  env["TF_DATA_DIR"] = dataRoot;
  if (definition.encrypted === true) {
    env["TF_VAR_tofu_state_encryption_passphrase"] =
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

async function commandOutput(
  command: string[],
  options: RunOptions,
): Promise<string> {
  const result = await run(command, {
    ...options,
    capture: true,
    echoCapturedStdout: false,
  });
  return result.stdout.trim();
}

async function prepareAsuswrtProvider(
  root: string,
  env: Record<string, string>,
): Promise<string> {
  const declaration = await Bun.file(
    `${root}/${STACKS_REL}/asuswrt/providers.tf`,
  ).text();
  const version =
    /source\s*=\s*"shepherdjerred\/asuswrt"[\s\S]*?version\s*=\s*"([^"]+)"/u.exec(
      declaration,
    )?.[1];
  if (version === undefined) {
    throw new Error("The AsusWRT provider declaration has no tracked version");
  }
  const temporaryRoot = await temporaryDirectory("asuswrt-provider", env);
  const options = isolatedOptions(env, root);
  const goos = await commandOutput(["go", "env", "GOOS"], options);
  const goarch = await commandOutput(["go", "env", "GOARCH"], options);
  const mirror = `${temporaryRoot}/mirror/registry.opentofu.org/shepherdjerred/asuswrt/${version}/${goos}_${goarch}`;
  await run(["mkdir", "-p", mirror], options);
  await run(
    [
      "go",
      "build",
      "-trimpath",
      "-buildvcs=false",
      "-o",
      `${mirror}/terraform-provider-asuswrt_v${version}`,
      ".",
    ],
    isolatedOptions(env, `${root}/../terraform-provider-asuswrt`),
  );
  const cliConfig = `${temporaryRoot}/tofu.tfrc`;
  await Bun.write(
    cliConfig,
    `provider_installation {\n  filesystem_mirror {\n    path = "${temporaryRoot}/mirror"\n    include = ["registry.opentofu.org/shepherdjerred/asuswrt"]\n  }\n  direct {}\n}\n`,
  );
  env["TF_CLI_CONFIG_FILE"] = cliConfig;
  return temporaryRoot;
}

async function removeTemporaryDirectory(path: string): Promise<void> {
  await run(["rm", "-rf", "--", path], isolatedOptions(ambientEnvironment()));
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
    const desiredState = await addDesiredStateEnvironment(
      stackDir,
      definition.platform,
      env,
    );
    addValidationOnlySecrets(definition.platform, desiredState, env);
  }
  let localProviderRoot: string | null = null;
  try {
    if (definition.localProvider === "asuswrt") {
      localProviderRoot = await prepareAsuswrtProvider(root, env);
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
    "Usage: bun packages/homelab/scripts/tofu-stack.ts <stack> validate|plan|apply [--dry-run]",
  );
  process.exit(1);
}

function parseAction(value: string | undefined): TofuAction {
  if (value === "validate" || value === "plan" || value === "apply") {
    return value;
  }
  return usage();
}

async function plan(
  stack: TofuStack,
  definition: StackDefinition,
  options: RunOptions,
): Promise<void> {
  const result = await runAllowExit(
    [
      "tofu",
      `-chdir=${STACKS_REL}/${stack}`,
      "plan",
      "-input=false",
      "-detailed-exitcode",
    ],
    options,
  );
  if (result.exitCode === 0) {
    console.log("No changes.");
    return;
  }
  if (result.exitCode === 2) {
    console.log("Changes detected.");
    return;
  }
  const message = `tofu plan failed (exit ${result.exitCode.toString()})`;
  if (definition.platform === undefined && isTransientError(result.stderr)) {
    throw new TransientError(message);
  }
  throw new Error(message);
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage();
  const positional = args.filter((argument) => !argument.startsWith("--"));
  const stackName = positional[0];
  if (stackName === undefined) usage();
  const stack = parseTofuStack(stackName);
  const action = parseAction(positional[1]);
  const root = homelabRoot();
  const stackDir = `${root}/${STACKS_REL}/${stack}`;
  if (!(await Bun.file(`${stackDir}/providers.tf`).exists())) {
    throw new Error(`Stack ${stack} has no providers.tf`);
  }
  if (args.includes("--dry-run")) {
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
  const options = isolatedOptions(env, root);
  await run(
    ["tofu", `-chdir=${STACKS_REL}/${stack}`, "init", "-input=false"],
    options,
  );
  if (action === "plan") {
    await plan(stack, definition, options);
    return;
  }
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
