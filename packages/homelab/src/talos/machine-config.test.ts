import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { shimDirectory } from "@shepherdjerred/toolkit/lib/passthrough.ts";
import { describe, expect, test } from "vitest";
import { stringify } from "yaml";
import { z } from "zod";
import {
  assertOnlySandboxPolicyChanged,
  parseMachineConfig,
  nativeTalosRunner,
  resolveNativeTalosExecutable,
  prepareTorvaldsSandboxUpdate,
  TORVALDS_SOURCE_PATCHES,
  validateTorvaldsSource,
  type TalosRunner,
} from "./machine-config.ts";

const profileName = "promotion-codex-01621-containerd-236-v1.json";
async function readPatch(name: string) {
  return parseMachineConfig(
    await Bun.file(
      new URL(`torvalds/patches/${name}.yaml`, import.meta.url),
    ).text(),
  );
}
function fixture(extraMachine: Record<string, unknown> = {}) {
  return (
    stringify({
      version: "v1alpha1",
      machine: {
        type: "controlplane",
        token: "synthetic-private-token-marker",
        ca: { crt: "synthetic-ca", key: "synthetic-private-key-marker" },
        sysctls: {
          "kernel.kptr_restrict": "1",
          "user.max_user_namespaces": "0",
        },
        seccompProfiles: [
          { name: "other.json", value: { defaultAction: "SCMP_ACT_ERRNO" } },
        ],
        kernel: {
          modules: [
            { name: "i915" },
            {
              name: "zfs",
              parameters: ["zfs_arc_max=17179869184", "zfs_arc_min=8589934592"],
            },
          ],
        },
        ...extraMachine,
      },
      cluster: {
        id: "unchanged-cluster-identity",
        secret: "synthetic-cluster-marker",
      },
    }) +
    "---\n" +
    stringify({
      apiVersion: "v1alpha1",
      kind: "ExtensionServiceConfig",
      name: "tailscale",
      environment: ["TS_AUTHKEY=synthetic-preserved-tailscale-marker"],
    })
  );
}

describe("bounded full-config sandbox update", () => {
  test("preserves credentials, unrelated policy, document content and exact validation bytes", async () => {
    const current = fixture();
    const calls: { args: readonly string[]; input?: string }[] = [];
    const runner: TalosRunner = async (args, input) => {
      calls.push(input === undefined ? { args } : { args, input });
      return "";
    };
    const result = await prepareTorvaldsSandboxUpdate(current, runner);
    expect(calls).toEqual([
      {
        args: ["validate", "--config", "/dev/stdin", "--mode", "metal"],
        input: result.config,
      },
    ]);
    expect(result.config).toContain("synthetic-private-key-marker");
    expect(result.config).toContain("synthetic-preserved-tailscale-marker");
    expect(result.config).toContain("other.json");
    expect(result.config).toContain(profileName);
    expect(result.evidence.quota).toBe("128");
    expect(result.evidence.changedPaths).toHaveLength(2);
    const publicEvidence = JSON.stringify(result.evidence);
    expect(publicEvidence).not.toContain("synthetic-");
    expect(publicEvidence).not.toContain("SCMP_ACT");
    expect(assertOnlySandboxPolicyChanged(current, result.config)).toBe(
      result.evidence.unchangedConfigSha256,
    );
  });

  test("is idempotent and preserves the order of unrelated profiles", async () => {
    const first = await prepareTorvaldsSandboxUpdate(fixture(), async () => "");
    const second = await prepareTorvaldsSandboxUpdate(
      first.config,
      async () => "",
    );
    expect(second.config).toBe(first.config);
    expect(second.evidence.beforeSha256).toBe(first.evidence.afterSha256);
  });

  test("handles absent policy maps without changing other configuration", async () => {
    const current = stringify({
      version: "v1alpha1",
      machine: { type: "controlplane" },
    });
    const result = await prepareTorvaldsSandboxUpdate(current, async () => "");
    expect(result.evidence.validated).toBe(true);
    expect(assertOnlySandboxPolicyChanged(current, result.config)).toBe(
      createHash("sha256")
        .update('[{"machine":{"type":"controlplane"},"version":"v1alpha1"}]')
        .digest("hex"),
    );
  });

  test("rejects duplicate owned profiles before validation", async () => {
    let validated = false;
    const current = fixture({
      seccompProfiles: [
        { name: profileName, value: {} },
        { name: profileName, value: {} },
      ],
    });
    await expect(
      prepareTorvaldsSandboxUpdate(current, async () => {
        validated = true;
        return "";
      }),
    ).rejects.toThrow("Duplicate promotion");
    expect(validated).toBe(false);
  });

  test("rejects unexpected current quotas and immutable profile mismatches", async () => {
    const currentStates = [
      fixture({ sysctls: { "user.max_user_namespaces": "512" } }),
      fixture({
        seccompProfiles: [
          { name: profileName, value: { defaultAction: "SCMP_ACT_ALLOW" } },
        ],
      }),
    ];
    for (const current of currentStates) {
      let validated = false;
      await expect(
        prepareTorvaldsSandboxUpdate(current, async () => {
          validated = true;
          return "";
        }),
      ).rejects.toThrow();
      expect(validated).toBe(false);
    }
  });

  test("rejects unrelated credential, resource, identity and profile changes", () => {
    const before = fixture();
    for (const after of [
      before.replace("synthetic-private-token-marker", "changed-token"),
      before.replace('kernel.kptr_restrict: "1"', 'kernel.kptr_restrict: "2"'),
      before.replace("unchanged-cluster-identity", "changed-cluster"),
      before.replace("other.json", "different.json"),
      before.replace(
        "synthetic-preserved-tailscale-marker",
        "changed-extension",
      ),
    ]) {
      expect(() => assertOnlySandboxPolicyChanged(before, after)).toThrow(
        "outside the sandbox policy allowlist",
      );
    }
  });

  test("fails loudly for invalid YAML and missing or repeated base documents without quoting private data", async () => {
    const marker = "synthetic-private-key-marker";
    for (const input of [
      `machine: [${marker}`,
      "apiVersion: v1alpha1\nkind: HostnameConfig\nhostname: test\n",
      fixture() + "---\n" + fixture(),
    ]) {
      try {
        await prepareTorvaldsSandboxUpdate(input, async () => "");
        throw new Error("Expected configuration rejection");
      } catch (error) {
        expect(String(error)).not.toContain(marker);
        expect(String(error)).not.toContain("Expected configuration rejection");
      }
    }
  });
});

test("source validation includes every declared patch and keeps synthetic generated bytes out of argv/results", async () => {
  const calls: { args: readonly string[]; input?: string }[] = [];
  const config = fixture();
  const result = await validateTorvaldsSource(async (args, input) => {
    calls.push(input === undefined ? { args } : { args, input });
    return args[0] === "gen" ? config : "";
  });
  expect(calls).toHaveLength(2);
  for (const patch of TORVALDS_SOURCE_PATCHES) {
    expect(
      calls[0]?.args.some((arg) => arg.endsWith(`/patches/${patch}.yaml`)),
    ).toBe(true);
  }
  expect(calls[0]?.args).toContain("v1.14.2");
  expect(calls[0]?.args).toContain("1.37.1");
  expect(calls[0]?.args.join(" ")).not.toContain(
    "synthetic-private-key-marker",
  );
  expect(calls[1]?.input).toBe(config);
  expect(JSON.stringify(result)).not.toContain("synthetic-private-key-marker");
});

test("migrated source retains installer, taints, SANs, DNS, kubelet budgets and proxy settings", async () => {
  const [
    images,
    scheduling,
    certsans,
    resolvers,
    kubelets,
    interfaces,
    apiserver,
  ] = await Promise.all(
    [
      "image",
      "scheduling",
      "certsans",
      "dns",
      "kubelet",
      "interface",
      "apiserver",
    ].map((name) => readPatch(name)),
  );
  const image = images?.find(
    (doc) => doc["kind"] === "UnattendedInstallConfig",
  );
  expect(image?.["provisioning"]).toEqual({
    diskSelector: { match: 'disk.serial == "S7KGNU0XB15590B"' },
    wipe: true,
  });
  expect(scheduling?.[0]?.["taints"]).toEqual({
    $patch: "delete",
  });
  expect(certsans?.[1]?.["certExtraSANs"]).toEqual([
    "torvalds.tailnet-1a49.ts.net",
    "192.168.1.81",
  ]);
  const dns = resolvers?.[0];
  expect(dns?.["nameservers"]).toEqual([
    { address: "100.100.100.100" },
    { address: "192.168.1.1" },
  ]);
  expect(dns?.["searchDomains"]).toEqual({ domains: ["tailnet-1a49.ts.net"] });
  const kubelet = kubelets?.[0];
  expect(kubelet?.["extraArgs"]).toEqual({ "max-pods": "300" });
  expect(kubelet?.["config"]).toEqual({
    systemReserved: { cpu: "4", memory: "18Gi" },
    systemReservedCgroup: "/system",
    kubeReserved: { cpu: "1", memory: "8Gi" },
    kubeReservedCgroup: "/podruntime",
    evictionHard: { "memory.available": "4Gi", "nodefs.available": "10%" },
    evictionSoft: { "memory.available": "8Gi", "nodefs.available": "15%" },
    evictionSoftGracePeriod: {
      "memory.available": "2m",
      "nodefs.available": "2m",
    },
    imageMaximumGCAge: "720h",
    imageGCHighThresholdPercent: 70,
    imageGCLowThresholdPercent: 60,
    podPidsLimit: 4096,
    enforceNodeAllocatable: ["pods", "system-reserved", "kube-reserved"],
  });
  expect(interfaces?.[0]?.["extraArgs"]).toEqual({
    "nodeport-addresses": "0.0.0.0/0",
  });
  expect(apiserver?.[0]?.["resources"]).toEqual({
    requests: { cpu: "200m", memory: "2816Mi" },
  });
});

test("source validation inventory covers every public torvalds patch", async () => {
  const paths = await readdir(new URL("torvalds/patches/", import.meta.url));
  const publicPatches = paths
    .filter(
      (name) =>
        name.endsWith(".yaml") &&
        !["tailscale.yaml", "tailscale.example.yaml"].includes(name),
    )
    .map((name) => name.slice(0, -5))
    .sort();
  expect([...TORVALDS_SOURCE_PATCHES].sort()).toEqual(publicPatches);
});

test("kernel modules have one source owner and retain ZFS and watchdog parameters", async () => {
  const batches = await Promise.all(
    ["image", "watchdog", "zfs"].map((name) => readPatch(name)),
  );
  const KernelDocument = z.object({
    machine: z.object({
      kernel: z.object({
        modules: z.array(
          z.object({
            name: z.string(),
            parameters: z.array(z.string()).optional(),
          }),
        ),
      }),
    }),
  });
  const modules = batches
    .flat()
    .filter((doc) => doc["machine"] !== undefined)
    .flatMap((doc) => KernelDocument.parse(doc).machine.kernel.modules);
  expect(modules).toEqual([
    { name: "i915" },
    { name: "iTCO_wdt", parameters: ["heartbeat=60", "nowayout=1"] },
    { name: "iTCO_vendor_support" },
    {
      name: "zfs",
      parameters: ["zfs_arc_max=17179869184", "zfs_arc_min=8589934592"],
    },
  ]);
  expect(new Set(modules.map((module) => module.name)).size).toBe(
    modules.length,
  );
});

test("source validation rejects a duplicate generated module instead of claiming readiness", async () => {
  const config = fixture({
    kernel: { modules: [{ name: "zfs" }, { name: "zfs" }] },
  });
  await expect(
    validateTorvaldsSource(async (args) => (args[0] === "gen" ? config : "")),
  ).rejects.toThrow("duplicate declarations");
});

test("native runner withholds credential-bearing stdout and diagnostics on failure", async () => {
  const runner = nativeTalosRunner(process.execPath);
  await expect(
    runner([
      "-e",
      "console.log('synthetic-private-stdout'); console.error('synthetic-private-stderr'); process.exit(23)",
    ]),
  ).rejects.toThrow("output withheld");
  try {
    await runner([
      "-e",
      "console.error('synthetic-private-stderr'); process.exit(23)",
    ]);
  } catch (error) {
    expect(String(error)).not.toContain("synthetic-private");
  }
});

test("default native resolver excludes toolkit shims, dependency binaries and relative PATH entries", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "talos-native-resolver-"),
  );
  try {
    const dependencyBin = path.join(directory, "node_modules", ".bin");
    const nativeBin = path.join(directory, "native-bin");
    await Promise.all([
      mkdir(dependencyBin, { recursive: true }),
      mkdir(nativeBin),
    ]);
    await Promise.all([
      symlink(process.execPath, path.join(dependencyBin, "talosctl")),
      symlink(process.execPath, path.join(nativeBin, "talosctl")),
    ]);
    const rejected = [shimDirectory(), dependencyBin, ".", "relative-bin"].join(
      path.delimiter,
    );
    expect(
      resolveNativeTalosExecutable([rejected, nativeBin].join(path.delimiter)),
    ).toBe(path.join(nativeBin, "talosctl"));
    expect(() => resolveNativeTalosExecutable(rejected)).toThrow(
      "Native talosctl is missing",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
