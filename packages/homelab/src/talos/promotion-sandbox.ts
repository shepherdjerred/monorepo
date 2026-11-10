import { createHash } from "node:crypto";
import { z } from "zod";
import { lookupExecutable } from "@shepherdjerred/toolkit/lib/passthrough.ts";
import { canonicalJson } from "#scripts/canonical-json.ts";
import {
  parseMachineConfig,
  prepareTorvaldsSandboxUpdate,
  type TalosRunner,
} from "./machine-config.ts";
import promotionPolicy from "./seccomp/promotion-policy.json";

export const TARGET = "torvalds.tailnet-1a49.ts.net";
const PROFILE_NAME = "promotion-codex-01621-containerd-236-v1.json";
const PROFILE_PATH = `/var/lib/kubelet/seccomp/profiles/${PROFILE_NAME}`;
const Resource = z.object({
  node: z.enum(["torvalds", TARGET]),
  metadata: z.object({ version: z.number().int().nonnegative() }),
  spec: z.string().min(1),
});
const ObjectValue = z.record(z.string(), z.unknown());
const RuntimeVersion = z.object({
  version: z.object({
    tag: z.literal(`v${promotionPolicy.talosVersion}`),
    os: z.literal("linux"),
    arch: z.literal("amd64"),
  }),
  platform: z.object({ name: z.literal("metal"), mode: z.literal("metal") }),
});
const KubernetesNode = z.object({
  metadata: z.object({ name: z.literal("torvalds") }),
  status: z.object({
    nodeInfo: z.object({
      architecture: z.literal("amd64"),
      operatingSystem: z.literal("linux"),
      containerRuntimeVersion: z.literal(
        `containerd://${promotionPolicy.containerdVersion}`,
      ),
      osImage: z.literal(`Talos (v${promotionPolicy.talosVersion})`),
      kernelVersion: z.string().min(1),
    }),
  }),
});
export type NodeInfoReader = () => Promise<string>;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Only errors constructed here are safe to show; native output is private. */
export class OperatorError extends Error {
  constructor(layer: string, detail: string) {
    super(`${layer}: ${detail}`);
    this.name = "OperatorError";
  }
}

async function atLayer<T>(
  layer: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new OperatorError(layer, "operation failed; native output withheld");
  }
}

/** Captures private native output; no configuration ever enters argv. */
async function captureNative(command: string[], input?: string) {
  const env = { ...Bun.env };
  delete env["OP_SERVICE_ACCOUNT_TOKEN"];
  // An ambient file must not bypass the authenticated wrapper.
  delete env["TALOSCONFIG"];
  const child = Bun.spawn(command, {
    env,
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 360_000,
  });
  const [stdout, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error("Native command failed; output withheld");
  return stdout;
}
export const brokeredTalosRunner: TalosRunner = (args, input) =>
  captureNative(["toolkit", "talosctl", ...args], input);
export const readNativeNodeInfo: NodeInfoReader = () => {
  const kubectl = lookupExecutable("kubectl", Bun.env["PATH"]);
  if (kubectl === null) {
    return Promise.reject(
      new OperatorError(
        "native kubectl tooling",
        "required executable not found",
      ),
    );
  }
  // Native kubectl retains its existing kubeconfig exec-plugin authentication.
  return captureNative([kubectl, "get", "node", "torvalds", "--output=json"]);
};

function targetArgs(args: readonly string[]) {
  return [...args, "--nodes", TARGET, "--endpoints", TARGET];
}

async function readConfig(runner: TalosRunner, layer: string, id = "v1alpha1") {
  return atLayer(layer, async () => {
    const output = await runner(
      targetArgs(["get", "machineconfig", id, "--output", "json"]),
    );
    return Resource.parse(JSON.parse(output));
  });
}

function requireSameConfig(left: string, right: string, layer: string) {
  let equal: boolean;
  try {
    equal = semanticHash(left) === semanticHash(right);
  } catch {
    throw new OperatorError(
      layer,
      "configuration parsing failed; source withheld",
    );
  }
  if (!equal) {
    throw new OperatorError(
      layer,
      "active and persistent configurations differ; inspect staged or temporary changes before proceeding",
    );
  }
}

async function readRuntimeVersion(runner: TalosRunner) {
  return atLayer("live Talos version and architecture", async () =>
    RuntimeVersion.parse(
      JSON.parse(await runner(targetArgs(["version", "--json"]))),
    ),
  );
}

function semanticHash(config: string) {
  return sha256(canonicalJson(parseMachineConfig(config)));
}

function assertExpectedStartingPolicy(config: string, profileHash: string) {
  const document = parseMachineConfig(config).find(
    (entry) => entry["version"] === "v1alpha1",
  );
  const machine = ObjectValue.parse(document?.["machine"]);
  const sysctls = ObjectValue.parse(machine["sysctls"] ?? {});
  const quota = sysctls["user.max_user_namespaces"];
  if (quota !== undefined && quota !== "0" && quota !== "128") {
    throw new Error("Unexpected starting namespace quota");
  }
  const profiles = z.array(ObjectValue).parse(machine["seccompProfiles"] ?? []);
  for (const profile of profiles) {
    if (
      profile["name"] === PROFILE_NAME &&
      sha256(canonicalJson(profile["value"])) !== profileHash
    ) {
      throw new Error("An existing named profile has different contents");
    }
  }
}

export type OperatorOptions = {
  /** Omit for a read-only plan; apply must name that plan's digest. */
  applyPlanSha256?: string;
};

/** One attempt only. Every credential-bearing object stays inside this call. */
export async function operatePromotionSandbox(
  options: OperatorOptions,
  runner: TalosRunner = brokeredTalosRunner,
  readNodeInfo: NodeInfoReader = readNativeNodeInfo,
) {
  const [runtime, nodeInfo] = await Promise.all([
    readRuntimeVersion(runner),
    atLayer(
      "live containerd version and node architecture",
      async () =>
        KubernetesNode.parse(JSON.parse(await readNodeInfo())).status.nodeInfo,
    ),
  ]);
  const before = await readConfig(runner, "read configuration");
  const persistent = await readConfig(
    runner,
    "read persistent configuration",
    "persistent",
  );
  requireSameConfig(
    before.spec,
    persistent.spec,
    "active/persistent preflight",
  );
  const prepared = await atLayer(
    "source policy and native full-config validation",
    async () => {
      const update = await prepareTorvaldsSandboxUpdate(before.spec, runner);
      assertExpectedStartingPolicy(before.spec, update.evidence.profileSha256);
      return update;
    },
  );
  const plan = {
    target: TARGET,
    runtime,
    nodeInfo,
    resourceVersion: before.metadata.version,
    persistentResourceVersion: persistent.metadata.version,
    persistentSha256: sha256(persistent.spec),
    ...prepared.evidence,
    beforeSemanticSha256: semanticHash(before.spec),
    afterSemanticSha256: semanticHash(prepared.config),
    concurrencyGuard:
      "fresh version and full-config hash preflight; not atomic CAS",
    mode: "no-reboot",
  };
  const planSha256 = sha256(canonicalJson(plan));
  if (options.applyPlanSha256 === undefined) {
    return { status: "planned", planSha256, ...plan };
  }
  if (options.applyPlanSha256 !== planSha256) {
    throw new OperatorError(
      "reviewed plan",
      "plan digest changed; inspect a fresh plan before applying",
    );
  }
  const [freshRuntime, freshNodeInfo] = await Promise.all([
    readRuntimeVersion(runner),
    atLayer(
      "fresh containerd runtime preflight",
      async () =>
        KubernetesNode.parse(JSON.parse(await readNodeInfo())).status.nodeInfo,
    ),
  ]);
  if (
    canonicalJson(freshRuntime) !== canonicalJson(runtime) ||
    canonicalJson(freshNodeInfo) !== canonicalJson(nodeInfo)
  ) {
    throw new OperatorError(
      "fresh runtime preflight",
      "runtime changed; inspect a fresh plan",
    );
  }
  const fresh = await readConfig(runner, "fresh preflight");
  const freshPersistent = await readConfig(
    runner,
    "fresh persistent preflight",
    "persistent",
  );
  if (
    fresh.metadata.version !== before.metadata.version ||
    sha256(fresh.spec) !== plan.beforeSha256 ||
    freshPersistent.metadata.version !== persistent.metadata.version ||
    sha256(freshPersistent.spec) !== plan.persistentSha256
  ) {
    throw new OperatorError(
      "fresh preflight",
      "concurrent configuration change; no apply submitted",
    );
  }
  // Talos has no compare-and-swap here. A race after this read remains possible.
  // A failed transport may follow a successful write: never retry or roll back.
  const alreadyConfigured =
    plan.beforeSemanticSha256 === plan.afterSemanticSha256;
  if (!alreadyConfigured) {
    await atLayer(
      "apply outcome unknown; inspect node before any further write",
      () =>
        runner(
          targetArgs([
            "apply-config",
            "--file",
            "/dev/stdin",
            "--mode=no-reboot",
          ]),
          prepared.config,
        ),
    );
  }
  const after = alreadyConfigured
    ? fresh
    : await readConfig(
        runner,
        "post-apply configuration readback; do not retry apply",
      );
  const afterPersistent = alreadyConfigured
    ? freshPersistent
    : await readConfig(
        runner,
        "post-apply persistent readback; do not retry apply",
        "persistent",
      );
  requireSameConfig(
    after.spec,
    afterPersistent.spec,
    "post-apply active/persistent comparison",
  );
  const afterHash = await atLayer(
    "post-apply semantic comparison; do not retry apply",
    () => semanticHash(after.spec),
  );
  if (afterHash !== plan.afterSemanticSha256) {
    throw new OperatorError(
      "post-apply semantic comparison",
      "configuration differs from candidate; stop and inspect, no rollback submitted",
    );
  }
  const quota = await atLayer(
    "runtime namespace quota readback; do not retry apply",
    () => runner(targetArgs(["read", "/proc/sys/user/max_user_namespaces"])),
  );
  if (quota.trim() !== "128")
    throw new OperatorError(
      "runtime namespace quota",
      "expected 128; stop and inspect",
    );
  const installed = await atLayer(
    "installed profile readback; do not retry apply",
    () => runner(targetArgs(["read", PROFILE_PATH])),
  );
  const installedSemanticHash = await atLayer(
    "installed profile parsing; do not retry apply",
    () => sha256(canonicalJson(JSON.parse(installed))),
  );
  if (installedSemanticHash !== plan.profileSha256) {
    throw new OperatorError(
      "installed profile comparison",
      "profile differs from reviewed source; stop and inspect",
    );
  }
  await atLayer("post-apply node health; do not retry apply", () =>
    runner(
      targetArgs([
        "health",
        "--server",
        "--run-e2e=false",
        "--wait-timeout",
        "5m",
      ]),
    ),
  );
  return {
    status: alreadyConfigured
      ? "already-configured-and-verified"
      : "applied-and-verified",
    planSha256,
    ...plan,
    readbackResourceVersion: after.metadata.version,
    readbackPersistentResourceVersion: afterPersistent.metadata.version,
    configSemanticEquality: true,
    observedQuota: "128",
    installedProfileSha256: sha256(installed),
    installedProfileSemanticSha256: installedSemanticHash,
    talosHealth: "passed",
    workloadAcceptance:
      "separate chart release and production container checks required",
  };
}

export function parseOperatorArgs(args: readonly string[]): OperatorOptions {
  if (args.length === 0) return {};
  const digest = args[1];
  if (
    digest !== undefined &&
    args.length === 2 &&
    args[0] === "--apply" &&
    /^[a-f0-9]{64}$/u.test(digest)
  ) {
    return { applyPlanSha256: digest };
  }
  throw new OperatorError(
    "arguments",
    "Usage: promotion-sandbox.ts [--apply <reviewed-plan-sha256>]",
  );
}

if (import.meta.main) {
  try {
    console.log(
      JSON.stringify(
        await operatePromotionSandbox(parseOperatorArgs(Bun.argv.slice(2))),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      error instanceof OperatorError
        ? error.message
        : "operator tooling: failed; private output withheld",
    );
    process.exitCode = 1;
  }
}
