import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { App, Chart, Size } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import { CLUSTER_ADMISSION_CHART } from "@shepherdjerred/homelab/cdk8s/src/resources/cluster-baseline/charts.ts";
import { transitionRendering } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { createStorageClasses } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import {
  getPvcBackupLabels,
  getPvcBackupPolicy,
  PVC_BACKUP_POLICY,
  pvcBackupPolicyKey,
} from "./pvc-backup-policy.ts";
import {
  createPvcBackupAdmissionPolicies,
  PVC_BACKUP_ADMISSION_BINDING_SYNC_WAVE,
  PVC_BACKUP_ADMISSION_POLICY_SYNC_WAVE,
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

const OperatorPostgresqlSchema = z.object({
  kind: z.literal("postgresql"),
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
  }),
  spec: z.object({
    numberOfInstances: z.number().int().positive(),
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

it.each([
  "data-filer-seaweedfs-filer-0",
  "data-seaweedfs-seaweedfs-master-0",
  "data-seaweedfs-volume-0",
  "idx-seaweedfs-volume-0",
])("includes SeaweedFS's %s in Velero's scheduled backups", (name) => {
  expect(getPvcBackupLabels(getPvcBackupPolicy("seaweedfs", name))).toEqual({
    "velero.io/backup": "enabled",
    "velero.io/exclude-from-backup": "false",
  });
});

it("includes Tracker's operator-managed database in backups before activation", () => {
  expect(
    getPvcBackupLabels(
      getPvcBackupPolicy("tracker", "pgdata-tracker-postgresql-0"),
    ),
  ).toEqual({
    "velero.io/backup": "enabled",
    "velero.io/exclude-from-backup": "false",
  });
});

it("retires per-app tailnet state while protecting the Delivery catalog", () => {
  expect(
    PVC_BACKUP_POLICY.map((entry) =>
      pvcBackupPolicyKey(entry.namespace, entry.name),
    ),
  ).not.toContain(pvcBackupPolicyKey("delivery", "delivery-tailnet-state"));
  expect(
    getPvcBackupPolicy("delivery", "pgdata-delivery-postgresql-0").backup,
  ).toBe("enabled");
});

it("classifies 60 included and 40 excluded PVCs, including the separate BlueMap cache", () => {
  const keys = PVC_BACKUP_POLICY.map((entry) =>
    pvcBackupPolicyKey(entry.namespace, entry.name),
  );
  expect(keys).toHaveLength(100);
  expect(new Set(keys).size).toBe(100);
  expect(
    PVC_BACKUP_POLICY.filter((entry) => entry.backup === "enabled"),
  ).toHaveLength(60);
  expect(
    PVC_BACKUP_POLICY.filter((entry) => entry.backup === "disabled"),
  ).toHaveLength(40);
  expect(
    getPvcBackupPolicy("minecraft-tsmc", "minecraft-tsmc-bluemap").backup,
  ).toBe("disabled");
  expect(
    getPvcBackupPolicy("minecraft-tsmc", "datadir-minecraft-tsmc-0").backup,
  ).toBe("enabled");
  expect(
    getPvcBackupPolicy("minecraft-tsmc-restore", "datadir-minecraft-tsmc-0")
      .backup,
  ).toBe("disabled");
  expect(
    getPvcBackupPolicy(
      "minecraft-tsmc-restore-3e5117f2",
      "datadir-minecraft-tsmc-0",
    ).backup,
  ).toBe("disabled");
});

describe("PVC backup policy", () => {
  it("classifies every synthesized and operator-managed PVC", async () => {
    const outdir = await mkdtemp(
      path.join(tmpdir(), "pvc-backup-policy-synth-"),
    );
    tempDirectories.push(outdir);
    const app = new App({ outdir });
    await setupCharts(app);
    app.synth();

    let pvcCount = 0;
    let operatorManagedPvcCount = 0;
    const admissionKinds = new Map<string, number>();
    for (const filename of await readdir(outdir)) {
      if (!filename.endsWith(".yaml")) {
        continue;
      }
      const rendered = await Bun.file(path.join(outdir, filename)).text();
      for (const document of parseAllDocuments(rendered)) {
        const manifest = document.toJS();
        const parsed = ManifestSchema.safeParse(manifest);
        if (!parsed.success) {
          continue;
        }
        // `cluster-admission` mirrors the root's admission objects one for one
        // (cluster-baseline.test.ts), so count each policy where the root has it.
        if (filename !== `${CLUSTER_ADMISSION_CHART}.k8s.yaml`) {
          const currentCount = admissionKinds.get(parsed.data.kind) ?? 0;
          admissionKinds.set(parsed.data.kind, currentCount + 1);
        }
        if (
          parsed.data.metadata.name === "delivery-tsmc-copy-reclaim.sjer.red"
        ) {
          const key = `copy:${parsed.data.kind}`;
          admissionKinds.set(key, (admissionKinds.get(key) ?? 0) + 1);
        }
        if (
          parsed.data.kind === "MutatingAdmissionPolicy" &&
          parsed.data.metadata.name.startsWith("pvc-backup-")
        ) {
          expect(
            MutatingAdmissionPolicySchema.parse(manifest).spec.matchConstraints,
          ).toEqual({
            matchPolicy: "Equivalent",
            namespaceSelector: {},
            objectSelector: {},
          });
        }
        const operatorPostgresql = OperatorPostgresqlSchema.safeParse(manifest);
        if (operatorPostgresql.success) {
          const { metadata, spec } = operatorPostgresql.data;
          for (let index = 0; index < spec.numberOfInstances; index += 1) {
            const name = `pgdata-${metadata.name}-${index.toString()}`;
            const policy = getPvcBackupPolicy(metadata.namespace, name);
            expect(policy).toMatchObject({
              namespace: metadata.namespace,
              name,
            });
            operatorManagedPvcCount += 1;
          }
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
    expect(operatorManagedPvcCount).toBeGreaterThan(0);
    // Includes one CI RAM scratch mutation per lane profile (verify, browser)
    // and the golden workspace clone mutation.
    expect(admissionKinds.get("MutatingAdmissionPolicy")).toBe(7);
    expect(admissionKinds.get("MutatingAdmissionPolicyBinding")).toBe(7);
    // The retired TSMC restoration controller no longer owns a copy guard.
    expect(admissionKinds.has("copy:ValidatingAdmissionPolicy")).toBe(false);
    expect(admissionKinds.has("copy:ValidatingAdmissionPolicyBinding")).toBe(
      false,
    );
    // PVC backup, ArgoCD lifecycle, CI pod, RAM scratch and workspace clone
    // guards, mc-harness sandbox pods and the read-only Forum observer CONNECT
    // guard remain. Transition rendering adds the Application source-writer
    // policy.
    const validating = transitionRendering() ? 8 : 7;
    expect(admissionKinds.get("ValidatingAdmissionPolicy")).toBe(validating);
    expect(admissionKinds.get("ValidatingAdmissionPolicyBinding")).toBe(
      validating,
    );
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
      const expectedWave = manifest.kind.endsWith("Binding")
        ? PVC_BACKUP_ADMISSION_BINDING_SYNC_WAVE
        : PVC_BACKUP_ADMISSION_POLICY_SYNC_WAVE;
      expect(manifest.metadata.annotations).toEqual({
        "argocd.argoproj.io/sync-wave": expectedWave,
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

  /**
   * Woodpecker names each workspace claim after its workflow, so no inventory
   * can list them; they are classified by class and namespace instead. Scoped
   * that tightly so the rule cannot excuse any other unlisted claim.
   */
  it("excludes CI workspace claims by class, only in the CI namespace", () => {
    const app = new App();
    const chart = new Chart(app, "pvc-backup-admission");
    createPvcBackupAdmissionPolicies(chart);
    const variables = parseAllDocuments(app.synthYaml())
      .map((document) =>
        z
          .object({
            kind: z.literal("ValidatingAdmissionPolicy"),
            spec: z.object({
              variables: z.array(
                z.object({ name: z.string(), expression: z.string() }),
              ),
            }),
          })
          .safeParse(document.toJS()),
      )
      .find((result) => result.success)?.data?.spec.variables;
    const expression = (name: string): string => {
      const found = variables?.find((variable) => variable.name === name);
      if (found === undefined) throw new Error(`no ${name} variable`);
      return found.expression;
    };

    const workspace =
      "object.metadata.namespace == 'woodpecker-ci' && has(object.spec.storageClassName) && object.spec.storageClassName == 'ci-workspace'";
    expect(expression("excluded")).toContain(`|| (${workspace})`);
    expect(expression("included")).not.toContain("ci-workspace");
  });

  /**
   * The class a workspace claim is excluded by must actually delete its
   * volume and only provision on the CI node, or the exclusion would excuse
   * data that accumulates on the production node.
   */
  it("deletes CI workspace volumes and provisions them only on liskov", () => {
    const app = new App();
    createStorageClasses(new Chart(app, "storage"));
    const storageClass = parseAllDocuments(app.synthYaml())
      .map((document) =>
        z
          .object({
            kind: z.literal("StorageClass"),
            metadata: z.object({ name: z.literal("ci-workspace") }),
            reclaimPolicy: z.string(),
            allowedTopologies: z.array(z.unknown()),
          })
          .loose()
          .safeParse(document.toJS()),
      )
      .find((result) => result.success);
    if (storageClass?.success !== true) {
      throw new Error("ci-workspace StorageClass not synthesized");
    }
    expect(storageClass.data.reclaimPolicy).toBe("Delete");
    expect(storageClass.data.allowedTopologies).toEqual([
      {
        matchLabelExpressions: [
          { key: "kubernetes.io/hostname", values: ["liskov"] },
        ],
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

describe("PostgreSQL restore backup policy", () => {
  it("retains every PostgreSQL source backup after retiring the PG18 restore copies", () => {
    const clusters = [
      ["scout-beta", "scout-beta", "scout-beta"],
      ["phoenix", "phoenix", "phoenix"],
      ["grafana", "prometheus", "grafana"],
      ["bugsink", "bugsink", "bugsink"],
      ["scout-prod", "scout-prod", "scout-prod"],
      ["temporal", "temporal", "temporal"],
      ["woodpecker", "woodpecker", "woodpecker"],
    ] as const;
    for (const [rehearsal, sourceNamespace, cluster] of clusters) {
      const name = `pgdata-${cluster}-postgresql-0`;
      expect(getPvcBackupPolicy(sourceNamespace, name).backup).toBe("enabled");
      expect(() =>
        getPvcBackupPolicy(`pg18-rehearsal-${rehearsal}`, name),
      ).toThrow("missing from the explicit backup policy");
    }
  });
});
