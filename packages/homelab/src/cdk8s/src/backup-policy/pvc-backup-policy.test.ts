import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { App, Chart, Size } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import {
  getPvcBackupLabels,
  getPvcBackupPolicy,
  PVC_BACKUP_POLICY,
  pvcBackupPolicyKey,
} from "./pvc-backup-policy.ts";
import {
  createPvcBackupAdmissionPolicies,
  PVC_BACKUP_ADMISSION_SYNC_WAVE,
} from "@shepherdjerred/homelab/cdk8s/src/resources/pvc-backup-admission.ts";

const ManifestSchema = z.object({
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    namespace: z.string().optional(),
    labels: z.record(z.string(), z.string()).optional(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
});

const MutatingAdmissionPolicySchema = z.object({
  kind: z.literal("MutatingAdmissionPolicy"),
  spec: z.object({
    matchConstraints: z.object({
      matchPolicy: z.literal("Equivalent"),
      namespaceSelector: z.object({}),
      objectSelector: z.object({}),
    }),
  }),
});

const ValidatingAdmissionPolicySchema = z.object({
  kind: z.literal("ValidatingAdmissionPolicy"),
  metadata: z.object({
    name: z.literal("pvc-backup-policy.sjer.red"),
  }),
  spec: z.object({
    matchConditions: z.array(
      z.object({
        name: z.string(),
        expression: z.string(),
      }),
    ),
  }),
});

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("PVC backup policy", () => {
  it("classifies 45 included and 23 excluded PVCs without duplicates", () => {
    const keys = PVC_BACKUP_POLICY.map((entry) =>
      pvcBackupPolicyKey(entry.namespace, entry.name),
    );
    expect(keys).toHaveLength(68);
    expect(new Set(keys).size).toBe(68);
    expect(
      PVC_BACKUP_POLICY.filter((entry) => entry.backup === "enabled"),
    ).toHaveLength(45);
    expect(
      PVC_BACKUP_POLICY.filter((entry) => entry.backup === "disabled"),
    ).toHaveLength(23);
  });

  it("classifies and labels every synthesized PVC", async () => {
    const outdir = await mkdtemp(
      path.join(tmpdir(), "pvc-backup-policy-synth-"),
    );
    tempDirectories.push(outdir);
    const app = new App({ outdir });
    await setupCharts(app);
    app.synth();

    let pvcCount = 0;
    const admissionKinds = new Map<string, number>();
    for (const filename of await readdir(outdir)) {
      if (!filename.endsWith(".yaml")) {
        continue;
      }
      const rendered = await Bun.file(path.join(outdir, filename)).text();
      for (const document of parseAllDocuments(rendered)) {
        const parsed = ManifestSchema.safeParse(document.toJS());
        if (!parsed.success) {
          continue;
        }
        const currentCount = admissionKinds.get(parsed.data.kind) ?? 0;
        admissionKinds.set(parsed.data.kind, currentCount + 1);
        if (parsed.data.kind === "MutatingAdmissionPolicy") {
          expect(
            MutatingAdmissionPolicySchema.parse(document.toJS()).spec
              .matchConstraints,
          ).toEqual({
            matchPolicy: "Equivalent",
            namespaceSelector: {},
            objectSelector: {},
          });
        }
        if (parsed.data.kind !== "PersistentVolumeClaim") {
          continue;
        }
        pvcCount += 1;
        const namespace = parsed.data.metadata.namespace;
        if (namespace === undefined) {
          throw new Error(
            `Synthesized PVC ${parsed.data.metadata.name} has no namespace`,
          );
        }
        const policy = getPvcBackupPolicy(namespace, parsed.data.metadata.name);
        expect(parsed.data.metadata.labels).toMatchObject(
          getPvcBackupLabels(policy),
        );
      }
    }

    expect(pvcCount).toBeGreaterThan(0);
    expect(admissionKinds.get("MutatingAdmissionPolicy")).toBe(2);
    expect(admissionKinds.get("MutatingAdmissionPolicyBinding")).toBe(2);
    expect(admissionKinds.get("ValidatingAdmissionPolicy")).toBe(1);
    expect(admissionKinds.get("ValidatingAdmissionPolicyBinding")).toBe(1);
  }, 20_000);

  it("syncs admission policy updates before PVC changes", () => {
    const app = new App();
    const chart = new Chart(app, "pvc-backup-admission");
    createPvcBackupAdmissionPolicies(chart);
    const admissionObjects = parseAllDocuments(app.synthYaml())
      .map((document) => ManifestSchema.parse(document.toJS()))
      .filter((manifest) => manifest.kind.includes("AdmissionPolicy"));

    expect(admissionObjects).toHaveLength(6);
    for (const manifest of admissionObjects) {
      expect(manifest.metadata.annotations).toEqual({
        "argocd.argoproj.io/sync-wave": PVC_BACKUP_ADMISSION_SYNC_WAVE,
      });
    }
  });

  it("checks deletion timestamp presence without reading an absent field", () => {
    const app = new App();
    const chart = new Chart(app, "pvc-backup-admission");
    createPvcBackupAdmissionPolicies(chart);
    const policy = parseAllDocuments(app.synthYaml())
      .map((document) =>
        ValidatingAdmissionPolicySchema.safeParse(document.toJS()),
      )
      .find((result) => result.success);
    if (!policy?.success) {
      throw new Error(
        "PVC backup ValidatingAdmissionPolicy was not synthesized",
      );
    }

    expect(policy.data.spec.matchConditions).toEqual([
      {
        name: "not-terminating",
        expression: "!has(object.metadata.deletionTimestamp)",
      },
    ]);
  });

  it("fails synthesis for an unclassified ZFS PVC", () => {
    const app = new App();
    const chart = new Chart(app, "unknown-pvc", {
      namespace: "test-unknown",
    });
    expect(
      () =>
        new ZfsNvmeVolume(chart, "missing-policy-entry", {
          storage: Size.gibibytes(1),
        }),
    ).toThrow(
      "PVC test-unknown/missing-policy-entry is missing from the explicit backup policy",
    );
  });
});
