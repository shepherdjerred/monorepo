/**
 * Builds the repository-owned AsusWRT provider into a throwaway filesystem
 * mirror. The provider is not published to a registry, so both the `asuswrt`
 * stack and the cdktn binding generator install it from this mirror.
 */
import path from "node:path";
import { run, tmpBase } from "@shepherdjerred/root-scripts/lib/run.ts";
import {
  loadProviderPins,
  providerAddress,
  type ProviderPin,
} from "./provider-versions.ts";

const PROVIDER_SOURCE = path.resolve(
  import.meta.dir,
  "../../../terraform-provider-asuswrt",
);

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
  const temporaryRoot = await output(
    ["mktemp", "-d", `${tmpBase()}/asuswrt-provider.XXXXXXXX`],
    env,
  );
  if (temporaryRoot === "")
    throw new Error("mktemp returned no path for the AsusWRT provider");
  const goos = await output(["go", "env", "GOOS"], env, PROVIDER_SOURCE);
  const goarch = await output(["go", "env", "GOARCH"], env, PROVIDER_SOURCE);
  const mirror = `${temporaryRoot}/mirror/${address}/${pin.version}/${goos}_${goarch}`;
  await run(["mkdir", "-p", mirror], { env, inheritEnv: false });
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
    { env, inheritEnv: false, cwd: PROVIDER_SOURCE },
  );
  const cliConfig = `${temporaryRoot}/tofu.tfrc`;
  await Bun.write(
    cliConfig,
    asuswrtProviderInstallationConfig(`${temporaryRoot}/mirror`, address),
  );
  env["TF_CLI_CONFIG_FILE"] = cliConfig;
  return temporaryRoot;
}
