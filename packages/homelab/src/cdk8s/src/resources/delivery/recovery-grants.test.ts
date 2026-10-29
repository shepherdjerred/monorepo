import { App, Chart } from "cdk8s";
import { expect, test } from "vitest";
import { z } from "zod";
import { createDeliveryJobs } from "./jobs.ts";
import { getPvcBackupPolicy } from "@shepherdjerred/homelab/cdk8s/src/backup-policy/pvc-backup-policy.ts";

test("Delivery catalog has an explicit enabled backup policy even before service activation", () => {
  expect(
    getPvcBackupPolicy("delivery", "pgdata-delivery-postgresql-0").backup,
  ).toBe("enabled");
  expect(
    getPvcBackupPolicy("delivery-tsmc-controller", "delivery-tsmc-journal")
      .backup,
  ).toBe("enabled");
});

test("only platform recovery gets a namespace-scoped read-only inspector; worker proof has no such account", () => {
  for (const profile of ["worker", "platform"] as const) {
    const chart = new Chart(new App(), `recovery-${profile}`, {
      namespace: "temporal",
    });
    createDeliveryJobs(
      chart,
      profile,
      "ngzmppq52zm7sii6ato2mv3sbi",
      profile === "platform" ? "issued-platform-item" : undefined,
    );
    const resources = z
      .array(
        z.object({
          kind: z.string(),
          metadata: z.object({
            name: z.string(),
            namespace: z.string().optional(),
          }),
          automountServiceAccountToken: z.boolean().optional(),
          rules: z
            .array(
              z.object({
                apiGroups: z.array(z.string()),
                resources: z.array(z.string()),
                verbs: z.array(z.string()),
              }),
            )
            .optional(),
          subjects: z.unknown().optional(),
        }),
      )
      .parse(chart.toJson());
    const inspector = resources.filter(
      (resource) => resource.metadata.name === "delivery-recovery-inspector",
    );
    if (profile === "worker") {
      expect(inspector).toEqual([]);
      continue;
    }
    expect(inspector.map((resource) => resource.kind).sort()).toEqual([
      "Role",
      "RoleBinding",
      "ServiceAccount",
    ]);
    expect(
      inspector.every(
        (resource) => resource.metadata.namespace === "delivery-platform-jobs",
      ),
    ).toBe(true);
    expect(
      inspector.find((resource) => resource.kind === "ServiceAccount")
        ?.automountServiceAccountToken,
    ).toBe(false);
    expect(
      inspector.find((resource) => resource.kind === "Role")?.rules,
    ).toEqual([
      { apiGroups: ["batch"], resources: ["jobs"], verbs: ["get"] },
      { apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] },
    ]);
    expect(
      inspector.find((resource) => resource.kind === "RoleBinding")?.subjects,
    ).toEqual([
      {
        kind: "ServiceAccount",
        name: "delivery-recovery-inspector",
        namespace: "delivery-platform-jobs",
      },
    ]);
    expect(
      resources.some((resource) => resource.kind.startsWith("ClusterRole")),
    ).toBe(false);
  }
});
