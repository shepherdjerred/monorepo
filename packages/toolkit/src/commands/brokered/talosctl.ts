import {
  resolveCredentialValues,
  withoutServiceAccountToken,
} from "#lib/credentials.ts";
import type { CredentialDeps } from "#lib/credentials.ts";
import { lookupExecutable } from "#lib/passthrough.ts";
import { spawnForwardingSignals } from "#lib/spawn-forwarding.ts";

/**
 * `toolkit talosctl …`: run talosctl with the homelab os:admin talosconfig
 * handed over an anonymous pipe (`--talosconfig /dev/fd/3`). talosctl has no
 * credential plugin, so this is the only way to keep the client key off disk.
 */

export const TALOS_ENDPOINT = "torvalds.tailnet-1a49.ts.net";

/** Subcommands that write a talosconfig, kubeconfig, or secrets to disk. */
const REFUSED_SUBCOMMANDS = new Map([
  ["config", "edits or writes a talosconfig file"],
  ["kubeconfig", "writes an admin kubeconfig to disk"],
  ["gen", "generates secrets and configs on disk"],
  ["cluster", "creates local clusters and writes their configs"],
]);

/** Global flags that take a separate value. */
const VALUE_FLAGS = new Set([
  "--talosconfig",
  "--context",
  "--cluster",
  "--siderov1-keys-dir",
  "-e",
  "--endpoints",
  "-n",
  "--nodes",
]);

export function talosSubcommand(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined || argument === "--") return undefined;
    if (!argument.startsWith("-")) return argument;
    if (VALUE_FLAGS.has(argument)) index += 1;
  }
  return undefined;
}

export function hasExplicitTalosconfig(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  const configured = environment["TALOSCONFIG"];
  return (
    (configured !== undefined && configured.length > 0) ||
    args.some(
      (argument) =>
        argument === "--talosconfig" || argument.startsWith("--talosconfig="),
    )
  );
}

/** Local invocations that need no credentials. */
export function isCredentialFreeTalosctl(args: readonly string[]): boolean {
  if (args.length === 0) return true;
  if (args.includes("--help") || args.includes("-h")) return true;
  const subcommand = talosSubcommand(args);
  return (
    subcommand === "help" ||
    subcommand === "completion" ||
    subcommand === "validate" ||
    (subcommand === "version" && args.includes("--client"))
  );
}

export function refusalFor(args: readonly string[]): string | null {
  const subcommand = talosSubcommand(args);
  if (subcommand === undefined) return null;
  const reason = REFUSED_SUBCOMMANDS.get(subcommand);
  return reason === undefined
    ? null
    : `toolkit: refusing \`talosctl ${subcommand}\`: it ${reason}. Run the real talosctl with an explicit --talosconfig if you intend that.`;
}

function decode(name: string, base64: string): string {
  const pem = Buffer.from(base64, "base64").toString("utf8");
  if (!pem.startsWith("-----BEGIN ")) {
    throw new Error(`toolkit: ${name} is not base64-encoded PEM`);
  }
  return base64;
}

/** A talosconfig document for the homelab cluster. */
export function talosconfigDocument(material: {
  readonly ca: string;
  readonly crt: string;
  readonly key: string;
}): string {
  return [
    "context: torvalds",
    "contexts:",
    "  torvalds:",
    `    ca: ${decode("TALOS_CA", material.ca)}`,
    `    crt: ${decode("TALOS_CRT", material.crt)}`,
    `    key: ${decode("TALOS_KEY", material.key)}`,
    "    endpoints:",
    `      - ${TALOS_ENDPOINT}`,
    "    nodes:",
    `      - ${TALOS_ENDPOINT}`,
    "",
  ].join("\n");
}

export async function runTalosctl(
  args: readonly string[],
  deps?: CredentialDeps,
): Promise<number> {
  // Linux exposes a spawned pipe that Bun creates as a socket, which
  // /dev/fd/3 cannot reopen by path; the handoff relies on macOS dup semantics.
  if (process.platform !== "darwin" && !isCredentialFreeTalosctl(args)) {
    console.error(
      "toolkit: `toolkit talosctl` hands the talosconfig over /dev/fd/3 and requires macOS; elsewhere pass --talosconfig explicitly.",
    );
    return 2;
  }
  const executable = lookupExecutable("talosctl", Bun.env["PATH"]);
  if (executable === null) {
    console.error("toolkit: required executable not found: talosctl");
    return 127;
  }
  const env = withoutServiceAccountToken(Bun.env);
  if (isCredentialFreeTalosctl(args) || hasExplicitTalosconfig(args, Bun.env)) {
    return spawnForwardingSignals([executable, ...args], { env });
  }
  const refusal = refusalFor(args);
  if (refusal !== null) {
    console.error(refusal);
    return 2;
  }
  const values = await resolveCredentialValues(
    ["TALOS_CA", "TALOS_CRT", "TALOS_KEY"],
    deps,
  );
  const document = talosconfigDocument({
    ca: values["TALOS_CA"] ?? "",
    crt: values["TALOS_CRT"] ?? "",
    key: values["TALOS_KEY"] ?? "",
  });
  return spawnForwardingSignals(
    [executable, "--talosconfig", "/dev/fd/3", ...args],
    { env, extraFiles: [document] },
  );
}
