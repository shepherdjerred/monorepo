/**
 * Builds the repository-owned AsusWRT provider into a throwaway filesystem
 * mirror. The provider is not published to a registry, so both the `asuswrt`
 * stack and the cdktn binding generator install it from this mirror.
 */
import path from "node:path";
import { z } from "zod";
import {
  run,
  runAllowExit,
  tmpBase,
} from "@shepherdjerred/root-scripts/lib/run.ts";
import {
  loadProviderPins,
  providerAddress,
  type ProviderPin,
} from "./provider-versions.ts";

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "../../../..");
const MISE_TOML_PATH = path.join(REPOSITORY_ROOT, ".mise.toml");
const PROVIDER_SOURCE = path.resolve(
  import.meta.dir,
  "../../../terraform-provider-asuswrt",
);

const MiseGoSchema = z.object({
  tools: z.object({
    go: z.string().min(1),
  }),
});

export async function pinnedGoVersion(
  miseTomlPath = MISE_TOML_PATH,
): Promise<string> {
  const parsed = MiseGoSchema.parse(
    Bun.TOML.parse(await Bun.file(miseTomlPath).text()),
  );
  return `go${parsed.tools.go}`;
}

export async function asuswrtProviderPin(): Promise<ProviderPin> {
  const pins = await loadProviderPins();
  const pin = pins.find(
    (candidate) => candidate.source === "shepherdjerred/asuswrt",
  );
  if (pin?.local !== true)
    throw new Error(
      "src/tofu/provider-versions.json does not pin the local AsusWRT provider",
    );
  return pin;
}

async function output(
  command: string[],
  env: Record<string, string>,
  cwd?: string,
): Promise<string> {
  const result = await run(command, {
    env,
    inheritEnv: false,
    capture: true,
    echoCapturedStdout: false,
    ...(cwd === undefined ? {} : { cwd }),
  });
  return result.stdout.trim();
}

async function probeMiseGoPath(
  env: Record<string, string>,
  repoRoot: string,
): Promise<string | undefined> {
  const miseDataDir = Bun.env["MISE_DATA_DIR"];
  const probeEnv =
    miseDataDir !== undefined && env["MISE_DATA_DIR"] === undefined
      ? { ...env, MISE_DATA_DIR: miseDataDir }
      : env;
  try {
    const result = await runAllowExit(["mise", "which", "go"], {
      cwd: repoRoot,
      env: probeEnv,
      inheritEnv: false,
      capture: true,
      echoCapturedStdout: false,
    });
    const candidate = result.stdout.trim();
    return candidate !== "" && result.exitCode === 0 ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves an isolated Go toolchain environment matching `.mise.toml`:
 * strips stale `GOROOT`, prepends `mise which go`'s directory when `mise` is
 * available, and verifies `go env GOVERSION` equals the repository pin.
 */
export async function resolveGoToolchainEnv(
  env: Record<string, string>,
  options?: { repoRoot?: string; expectedGoVersion?: string },
): Promise<Record<string, string>> {
  const repoRoot = options?.repoRoot ?? REPOSITORY_ROOT;
  const resolved: Record<string, string> = { ...env };
  delete resolved["GOROOT"];

  const miseGo = await probeMiseGoPath(resolved, repoRoot);
  if (miseGo !== undefined) {
    const goBinDir = path.dirname(miseGo);
    const existingPath = resolved["PATH"] ?? "";
    resolved["PATH"] =
      existingPath === ""
        ? goBinDir
        : `${goBinDir}${path.delimiter}${existingPath}`;
  }

  const expectedVersion =
    options?.expectedGoVersion ??
    (await pinnedGoVersion(path.join(repoRoot, ".mise.toml")));
  const actualVersion = await output(["go", "env", "GOVERSION"], resolved);
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Go toolchain version mismatch for AsusWRT provider: resolved ${actualVersion || "<empty>"}, expected ${expectedVersion} from .mise.toml`,
    );
  }
  return resolved;
}

/** The unpublished local provider must never be resolved through a registry. */
export function asuswrtProviderInstallationConfig(
  mirrorRoot: string,
  address: string,
): string {
  return `provider_installation {\n  filesystem_mirror {\n    path = ${JSON.stringify(mirrorRoot)}\n    include = [${JSON.stringify(address)}]\n  }\n  direct {\n    exclude = [${JSON.stringify(address)}]\n  }\n}\n`;
}

/**
 * Compiles the provider at its pinned version and points `TF_CLI_CONFIG_FILE`
 * in `env` at a CLI configuration that serves it. Returns the temporary root
 * the caller removes when OpenTofu is done.
 */
export async function prepareAsuswrtProvider(
  env: Record<string, string>,
): Promise<string> {
  const pin = await asuswrtProviderPin();
  const address = providerAddress(pin);
  const goEnv = await resolveGoToolchainEnv(env);
  const temporaryRoot = await output(
    ["mktemp", "-d", `${tmpBase()}/asuswrt-provider.XXXXXXXX`],
    goEnv,
  );
  if (temporaryRoot === "")
    throw new Error("mktemp returned no path for the AsusWRT provider");
  const goos = await output(["go", "env", "GOOS"], goEnv, PROVIDER_SOURCE);
  const goarch = await output(["go", "env", "GOARCH"], goEnv, PROVIDER_SOURCE);
  const mirror = `${temporaryRoot}/mirror/${address}/${pin.version}/${goos}_${goarch}`;
  await run(["mkdir", "-p", mirror], { env: goEnv, inheritEnv: false });
  await run(
    [
      "go",
      "build",
      "-trimpath",
      "-buildvcs=false",
      "-o",
      `${mirror}/terraform-provider-asuswrt_v${pin.version}`,
      ".",
    ],
    { env: goEnv, inheritEnv: false, cwd: PROVIDER_SOURCE },
  );
  const cliConfig = `${temporaryRoot}/tofu.tfrc`;
  await Bun.write(
    cliConfig,
    asuswrtProviderInstallationConfig(`${temporaryRoot}/mirror`, address),
  );
  env["TF_CLI_CONFIG_FILE"] = cliConfig;
  return temporaryRoot;
}
