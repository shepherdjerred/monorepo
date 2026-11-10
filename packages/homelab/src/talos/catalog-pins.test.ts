import { expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import {
  parseVersionCatalog,
  upstreamName,
  type VersionCatalogEntry,
} from "@shepherdjerred/version-catalog";
import rawVersionCatalog from "@shepherdjerred/version-catalog/catalog.json";
import promotionPolicy from "./seccomp/promotion-policy.json";

/**
 * The `cluster-nodes` components (Delivery model X13) are the images each
 * node runs today: its Talos factory installer and the kubelet. They pin the
 * same releases as the Talos and Kubernetes source entries, and each
 * installer is exactly its node's machine-config image, so a version change
 * moves every pin together with the live upgrade.
 */
const catalog = parseVersionCatalog(rawVersionCatalog);
function entry(name: string): VersionCatalogEntry {
  const found = catalog.entries.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`Version catalog lacks ${name}`);
  return found;
}

const LegacyInstallSchema = z.looseObject({
  kind: z.never().optional(),
  machine: z.looseObject({
    install: z.looseObject({ image: z.string() }),
  }),
});
const ModernInstallSchema = z.looseObject({
  kind: z.literal("UnattendedInstallConfig"),
  installer: z.looseObject({ image: z.string() }),
});

function installerFromDocuments(
  text: string,
  node: "torvalds" | "liskov",
): string {
  const documents = parseAllDocuments(text).map((document) => {
    const [error] = document.errors;
    if (error !== undefined) throw error;
    return z
      .looseObject({
        kind: z.unknown().optional(),
        installer: z.unknown().optional(),
        machine: z.looseObject({ install: z.unknown().optional() }).optional(),
      })
      .parse(document.toJSON());
  });
  const schema =
    node === "torvalds" ? ModernInstallSchema : LegacyInstallSchema;
  const installers = documents.filter(
    (document) =>
      document.kind === "UnattendedInstallConfig" ||
      document.installer !== undefined ||
      document.machine?.install !== undefined,
  );
  if (installers.length !== 1)
    throw new Error(`Expected exactly one ${node} installer document`);
  const installer = schema.parse(installers[0]);
  return node === "torvalds"
    ? ModernInstallSchema.parse(installer).installer.image
    : LegacyInstallSchema.parse(installer).machine.install.image;
}

async function installerImage(node: "torvalds" | "liskov"): Promise<string> {
  const text = await Bun.file(
    new URL(`${node}/patches/image.yaml`, import.meta.url),
  ).text();
  return installerFromDocuments(text, node);
}

test("installer documents reject missing, unknown and duplicate candidates", () => {
  const modern = "kind: UnattendedInstallConfig\ninstaller:\n  image: test\n";
  const legacy = "machine:\n  install:\n    image: test\n";
  expect(installerFromDocuments(modern, "torvalds")).toBe("test");
  expect(installerFromDocuments(legacy, "liskov")).toBe("test");
  for (const [node, valid, invalid] of [
    ["torvalds", modern, modern.replace("UnattendedInstallConfig", "Unknown")],
    ["liskov", legacy, "machine: {}"],
  ] as const) {
    expect(() => installerFromDocuments(invalid, node)).toThrow();
    expect(() => installerFromDocuments("{}", node)).toThrow();
    expect(() =>
      installerFromDocuments(`${valid}\n---\n${valid}`, node),
    ).toThrow();
  }
  expect(() => installerFromDocuments(legacy, "torvalds")).toThrow();
  expect(() => installerFromDocuments(modern, "liskov")).toThrow();
  expect(() =>
    installerFromDocuments(
      `${modern}\n---\nkind: UnattendedInstallConfig`,
      "torvalds",
    ),
  ).toThrow();
});

test("each node's installer component is its machine-config image at the Talos release", async () => {
  const talos = entry("siderolabs/talos").value;
  for (const node of ["liskov", "torvalds"] as const) {
    const installer = entry(`siderolabs/installer-${node}`);
    expect(installer.component, node).toBe(true);
    expect(installer.value.startsWith(`v${talos}@sha256:`), node).toBe(true);
    expect(
      `factory.talos.dev/${upstreamName(installer)}:${installer.value}`,
    ).toBe(await installerImage(node));
  }
});

test("the kubelet component pins the Kubernetes release", () => {
  const kubelet = entry("siderolabs/kubelet");
  expect(kubelet.component).toBe(true);
  expect(kubelet.value).toMatch(/^v[\d.]+@sha256:[a-f0-9]{64}$/u);
  expect(kubelet.value.slice(0, kubelet.value.indexOf("@"))).toBe(
    entry("kubernetes/kubernetes").value,
  );
});

const Argument = z.strictObject({
  index: z.number().int(),
  value: z.number().int(),
  valueTwo: z.number().int().optional(),
  op: z.string(),
});
const Syscall = z.strictObject({
  names: z.array(z.string()).min(1),
  action: z.string(),
  args: z.array(Argument).optional(),
  errnoRet: z.number().int().optional(),
});
const Profile = z.strictObject({
  defaultAction: z.literal("SCMP_ACT_ERRNO"),
  architectures: z.array(z.string()),
  syscalls: z.array(Syscall),
});

test("promotion node profile preserves the reviewed containerd baseline and exact delta", async () => {
  const [document] = parseAllDocuments(
    await Bun.file(
      new URL("torvalds/patches/promotion-seccomp.yaml", import.meta.url),
    ).text(),
  );
  const rendered = z
    .strictObject({
      machine: z.strictObject({
        seccompProfiles: z.tuple([
          z.strictObject({ name: z.string(), value: Profile }),
        ]),
      }),
    })
    .parse(document?.toJSON()).machine.seccompProfiles[0];
  expect(rendered.name).toBe(promotionPolicy.profileName);
  expect(rendered.value.architectures).toEqual([
    "SCMP_ARCH_X86_64",
    "SCMP_ARCH_X86",
    "SCMP_ARCH_X32",
  ]);
  const { syscalls, ...fields } = rendered.value;
  expect(syscalls.slice(-promotionPolicy.delta.length)).toEqual(
    promotionPolicy.delta,
  );
  const baseline = {
    ...fields,
    syscalls: syscalls.slice(0, -promotionPolicy.delta.length),
  };
  expect(
    new Bun.CryptoHasher("sha256")
      .update(JSON.stringify(baseline))
      .digest("hex"),
  ).toBe(promotionPolicy.baselineSha256);
  expect(baseline.syscalls).toContainEqual({
    names: ["clone3"],
    action: "SCMP_ACT_ERRNO",
    errnoRet: 38,
  });
  expect(promotionPolicy.delta).toEqual([
    ...[0x38_02_00_11, 0x78_02_00_11].map((value) => ({
      names: ["clone"],
      action: "SCMP_ACT_ALLOW",
      args: [{ index: 0, value, op: "SCMP_CMP_EQ" }],
    })),
    {
      names: ["unshare"],
      action: "SCMP_ACT_ALLOW",
      args: [{ index: 0, value: 0x10_00_00_00, op: "SCMP_CMP_EQ" }],
    },
    { names: ["mount", "pivot_root"], action: "SCMP_ACT_ALLOW" },
    {
      names: ["umount2"],
      action: "SCMP_ACT_ALLOW",
      args: [{ index: 1, value: 2, op: "SCMP_CMP_EQ" }],
    },
  ]);
});

test("promotion profile provenance follows the node, provider and actual worker capabilities", async () => {
  expect(promotionPolicy.talosVersion).toBe(entry("siderolabs/talos").value);
  const temporalPackage = z
    .object({
      dependencies: z.object({ "@openai/codex-sdk": z.string() }),
    })
    .parse(
      await Bun.file(
        new URL("../../../temporal/package.json", import.meta.url),
      ).json(),
    );
  expect(promotionPolicy.codexVersion).toBe(
    temporalPackage.dependencies["@openai/codex-sdk"],
  );
  const module = await Bun.file(
    new URL("seccomp/go.mod", import.meta.url),
  ).text();
  expect(module).toContain(
    `github.com/containerd/containerd/v2 v${promotionPolicy.containerdVersion}\n`,
  );
  const worker = await Bun.file(
    new URL(
      "../cdk8s/src/resources/temporal/workers/agent-worker.ts",
      import.meta.url,
    ),
  ).text();
  expect(
    [...worker.matchAll(/Capability\.([A-Z_]+)/gu)]
      .map((match) => `CAP_${match[1] ?? ""}`)
      .filter((capability) => capability !== "CAP_ALL"),
  ).toEqual(promotionPolicy.capabilities);
  expect(worker).toContain("drop: [Capability.ALL]");
  expect(worker).toContain("allowPrivilegeEscalation: false");
  const [sysctls] = parseAllDocuments(
    await Bun.file(
      new URL("torvalds/patches/sysctls.yaml", import.meta.url),
    ).text(),
  );
  expect(sysctls?.toJSON()).toMatchObject({
    machine: { sysctls: { "user.max_user_namespaces": "128" } },
  });
  const ciSysctls = await Bun.file(
    new URL("liskov/patches/sysctls.yaml", import.meta.url),
  ).text();
  expect(ciSysctls).not.toContain("user.max_user_namespaces");
});
