import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseAllDocuments, stringify } from "yaml";
import { z } from "zod";
import { parseVersionCatalog } from "@shepherdjerred/version-catalog";
import rawVersionCatalog from "@shepherdjerred/version-catalog/catalog.json";
import { lookupExecutable } from "@shepherdjerred/toolkit/lib/passthrough.ts";
import { canonicalJson } from "#scripts/canonical-json.ts";

const ObjectSchema = z.record(z.string(), z.unknown());
const PROFILE_NAME = "promotion-codex-01621-containerd-236-v1.json";
const catalog = parseVersionCatalog(rawVersionCatalog);
const sourceRoot = new URL("torvalds/patches/", import.meta.url);

export type TalosRunner = (
  args: readonly string[],
  input?: string,
) => Promise<string>;

function object(value: unknown): Record<string, unknown> {
  const parsed = ObjectSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid Talos configuration object");
  return parsed.data;
}

export function parseMachineConfig(text: string): Record<string, unknown>[] {
  const documents = parseAllDocuments(text, { uniqueKeys: true });
  if (
    documents.length === 0 ||
    documents.some((doc) => doc.errors.length > 0)
  ) {
    // YAML errors can quote credential-bearing source lines.
    throw new Error("Invalid Talos configuration YAML; source withheld");
  }
  return documents.map((document) => object(document.toJSON()));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function version(name: string): string {
  const entry = catalog.entries.find((candidate) => candidate.name === name);
  if (entry === undefined)
    throw new Error(`Missing version catalog entry ${name}`);
  return entry.value;
}

function publicPatch(name: string): string {
  return fileURLToPath(new URL(`${name}.yaml`, sourceRoot));
}

export function resolveNativeTalosExecutable(
  pathValue = Bun.env["PATH"],
): string {
  const executable = lookupExecutable("talosctl", pathValue);
  if (executable === null) {
    throw new Error("Native talosctl is missing from trusted executable paths");
  }
  return executable;
}

/** Captures all credential-bearing child output; never forwards it to logs. */
export function nativeTalosRunner(executable?: string): TalosRunner {
  const resolvedExecutable = executable ?? resolveNativeTalosExecutable();
  return async (args, input) => {
    const child = Bun.spawn([resolvedExecutable, ...args], {
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `Talos ${args[0] ?? "command"} failed (exit ${String(exitCode)}); output withheld`,
      );
    }
    return stdout;
  };
}

export const TORVALDS_SOURCE_PATCHES = [
  "scheduling",
  "certsans",
  "apiserver",
  "etcd-metrics",
  "image",
  "dns",
  "kubelet",
  "sysctls",
  "promotion-seccomp",
  "watchdog",
  "zfs",
  "interface",
] as const;

/** Entire source graph, real generator and validator, synthetic credentials only. */
export async function validateTorvaldsSource(
  runner: TalosRunner = nativeTalosRunner(),
) {
  const talosVersion = version("siderolabs/talos");
  const args = [
    "gen",
    "config",
    "torvalds",
    "https://192.168.1.81:6443",
    "--talos-version",
    `v${talosVersion}`,
    "--kubernetes-version",
    version("kubernetes/kubernetes").replace(/^v/u, ""),
    "--output-types",
    "controlplane",
    "--output",
    "-",
    "--with-docs=false",
    "--with-examples=false",
  ];
  for (const patch of TORVALDS_SOURCE_PATCHES) {
    args.push("--config-patch", `@${publicPatch(patch)}`);
  }
  // Same extension document shape as the private patch; never read its token.
  args.push(
    "--config-patch",
    stringify({
      apiVersion: "v1alpha1",
      kind: "ExtensionServiceConfig",
      name: "tailscale",
      environment: ["TS_AUTHKEY=synthetic-fixture-not-a-credential"],
    }),
  );
  const config = await runner(args);
  await runner(
    ["validate", "--config", "/dev/stdin", "--mode", "metal"],
    config,
  );
  const documents = parseMachineConfig(config);
  const kernel = object(
    object(machineDocument(documents)["machine"])["kernel"],
  );
  const modules = z.array(ObjectSchema).safeParse(kernel["modules"]);
  if (!modules.success)
    throw new Error("Generated Talos kernel module list is invalid");
  const moduleNames = modules.data.map((module) => module["name"]);
  if (new Set(moduleNames).size !== moduleNames.length) {
    throw new Error(
      "Generated Talos kernel module list contains duplicate declarations",
    );
  }
  return {
    validated: true,
    talosVersion,
    patches: TORVALDS_SOURCE_PATCHES,
    documentCount: documents.length,
    kernelModules: moduleNames,
    credentials: "synthetic-in-memory-only",
  };
}

function machineDocument(documents: Record<string, unknown>[]) {
  const matches = documents.filter(
    (document) => document["version"] === "v1alpha1",
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error("Expected exactly one v1alpha1 Talos machine document");
  }
  return matches[0];
}

function profiles(machine: Record<string, unknown>): Record<string, unknown>[] {
  const value = machine["seccompProfiles"];
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new TypeError("Invalid Talos seccomp profile list");
  return value.map((entry: unknown) => object(entry));
}

function withoutOwnedPolicy(documents: Record<string, unknown>[]) {
  const copy = structuredClone(documents);
  const machine = object(machineDocument(copy)["machine"]);
  const sysctls = object(machine["sysctls"] ?? {});
  delete sysctls["user.max_user_namespaces"];
  if (Object.keys(sysctls).length === 0) delete machine["sysctls"];
  else machine["sysctls"] = sysctls;
  const retained = profiles(machine).filter(
    (profile) => profile["name"] !== PROFILE_NAME,
  );
  if (retained.length === 0) delete machine["seccompProfiles"];
  else machine["seccompProfiles"] = retained;
  machineDocument(copy)["machine"] = machine;
  return canonicalJson(copy);
}

export function assertOnlySandboxPolicyChanged(before: string, after: string) {
  const prior = withoutOwnedPolicy(parseMachineConfig(before));
  const next = withoutOwnedPolicy(parseMachineConfig(after));
  if (prior !== next) {
    throw new Error(
      "Talos update changed configuration outside the sandbox policy allowlist",
    );
  }
  return hash(prior);
}

/**
 * Prepares full-config bytes for the operator's authenticated stdin apply.
 * Never regenerates live credentials/defaults or performs a live operation.
 */
export async function prepareTorvaldsSandboxUpdate(
  current: string,
  runner: TalosRunner = nativeTalosRunner(),
) {
  const sysctlPatch = parseMachineConfig(
    await Bun.file(publicPatch("sysctls")).text(),
  );
  const declaredQuota = object(object(sysctlPatch[0]?.["machine"])["sysctls"])[
    "user.max_user_namespaces"
  ];
  if (declaredQuota !== "128")
    throw new Error("Unexpected declared sandbox namespace quota");
  const profilePatch = parseMachineConfig(
    await Bun.file(publicPatch("promotion-seccomp")).text(),
  );
  const declaredProfiles = profiles(object(profilePatch[0]?.["machine"]));
  const declaredProfile = declaredProfiles[0];
  if (
    declaredProfiles.length !== 1 ||
    declaredProfile?.["name"] !== PROFILE_NAME
  ) {
    throw new Error("Expected exactly the declared promotion seccomp profile");
  }
  const documents = parseMachineConfig(current);
  const document = machineDocument(documents);
  const machine = object(document["machine"]);
  const sysctls = object(machine["sysctls"] ?? {});
  const currentQuota = sysctls["user.max_user_namespaces"];
  if (
    currentQuota !== undefined &&
    currentQuota !== "0" &&
    currentQuota !== "128"
  ) {
    throw new Error(
      "Current namespace quota is outside the approved absent/0/128 transition",
    );
  }
  sysctls["user.max_user_namespaces"] = declaredQuota;
  machine["sysctls"] = sysctls;
  const existingProfiles = profiles(machine);
  const matches = existingProfiles.filter(
    (profile) => profile["name"] === PROFILE_NAME,
  );
  if (matches.length > 1)
    throw new Error("Duplicate promotion seccomp profiles in current config");
  if (
    matches[0] !== undefined &&
    canonicalJson(matches[0]) !== canonicalJson(declaredProfile)
  ) {
    throw new Error(
      "Existing versioned promotion seccomp profile differs from the declared immutable profile",
    );
  }
  const updatedProfiles = existingProfiles.map((profile) =>
    profile["name"] === PROFILE_NAME ? declaredProfile : profile,
  );
  if (matches.length === 0) updatedProfiles.push(declaredProfile);
  machine["seccompProfiles"] = updatedProfiles;
  document["machine"] = machine;
  const config = documents.map((entry) => stringify(entry)).join("---\n");
  const unchangedConfigSha256 = assertOnlySandboxPolicyChanged(current, config);
  await runner(
    ["validate", "--config", "/dev/stdin", "--mode", "metal"],
    config,
  );
  return {
    config,
    evidence: {
      validated: true,
      beforeSha256: hash(current),
      afterSha256: hash(config),
      unchangedConfigSha256,
      quota: declaredQuota,
      profileName: PROFILE_NAME,
      profileSha256: hash(canonicalJson(declaredProfile["value"])),
      changedPaths: [
        "machine.sysctls.user.max_user_namespaces",
        `machine.seccompProfiles[name=${PROFILE_NAME}]`,
      ],
    },
  };
}

if (import.meta.main) {
  try {
    const args = Bun.argv.slice(2);
    const mode = args.shift() ?? "validate-source";
    const executable =
      args.length === 2 && args[0] === "--talosctl" ? args[1] : undefined;
    if (
      (executable === undefined && args.length > 0) ||
      !["validate-source", "plan-update"].includes(mode)
    ) {
      throw new Error(
        "Usage: machine-config.ts [validate-source|plan-update] [--talosctl <path>]",
      );
    }
    const runner = nativeTalosRunner(executable);
    let result;
    if (mode === "validate-source") {
      result = await validateTorvaldsSource(runner);
    } else {
      const update = await prepareTorvaldsSandboxUpdate(
        await Bun.stdin.text(),
        runner,
      );
      result = update.evidence;
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Talos configuration operation failed",
    );
    process.exitCode = 1;
  }
}
