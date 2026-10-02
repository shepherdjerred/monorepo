import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findTemporalResource,
  synthesizeTemporalResources,
} from "@shepherdjerred/homelab/cdk8s/src/temporal-test-resources.ts";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";

const AUDIT_FIELDS = [
  "VELERO_R2_S3_ENDPOINT",
  "VELERO_R2_S3_BUCKET",
  "VELERO_R2_S3_ACCESS_KEY_ID",
  "VELERO_R2_S3_SECRET_ACCESS_KEY",
] as const;

const DeploymentSchema = z.object({
  template: z.object({
    spec: z.object({
      containers: z.array(z.object({ env: ContainerEnvSchema })),
    }),
  }),
});

describe("Velero R2 read-only audit credential boundary", () => {
  test("references its dedicated 1Password item and gives only infra required secret fields", () => {
    const resources = synthesizeTemporalResources(".test-synth-r2-audit");
    const item = findTemporalResource(
      resources,
      "OnePasswordItem",
      "temporal-velero-r2-audit",
    );
    expect(
      z.object({ itemPath: z.string() }).parse(item.spec).itemPath,
    ).toMatch(/\/items\/vz3yuhrsci5hkm5yhkpi5ufpzi$/u);

    const deployments = resources.filter(
      (resource) => resource.kind === "Deployment",
    );
    expect(
      deployments.filter(
        (deployment) =>
          deployment.metadata.name === "temporal-temporal-infra-worker",
      ),
    ).toHaveLength(1);
    for (const deployment of deployments) {
      const containers = DeploymentSchema.parse(deployment.spec).template.spec
        .containers;
      for (const container of containers) {
        const auditFields = container.env.filter((field) =>
          field.name.startsWith("VELERO_R2_"),
        );
        if (deployment.metadata.name === "temporal-temporal-infra-worker") {
          expect(auditFields).toHaveLength(AUDIT_FIELDS.length);
          for (const key of AUDIT_FIELDS) {
            expect(auditFields).toContainEqual({
              name: key,
              valueFrom: { secretKeyRef: { key, name: item.metadata.name } },
            });
          }
          // Check the raw manifest: the shared env parser intentionally strips
          // unknown fields, including Kubernetes's optional-secret flag.
          expect(JSON.stringify(deployment.spec)).not.toContain(
            '"optional":true',
          );
        } else {
          expect(auditFields).toEqual([]);
          expect(JSON.stringify(deployment.spec)).not.toContain(
            item.metadata.name,
          );
        }
      }
    }
  });

  test("retains Schedule inventory access for the infra worker through its existing reader binding", () => {
    const resources = synthesizeTemporalResources(".test-synth-r2-audit-rbac");
    const role = findTemporalResource(
      resources,
      "ClusterRole",
      "temporal-worker-audit-reader",
    );
    const reader = z
      .object({
        rules: z.array(
          z.object({
            apiGroups: z.array(z.string()),
            resources: z.array(z.string()),
            verbs: z.array(z.string()),
          }),
        ),
      })
      .parse(role);
    expect(reader.rules).toContainEqual({
      apiGroups: ["velero.io"],
      resources: ["backups", "schedules", "backupstoragelocations", "restores"],
      verbs: ["get", "list", "watch"],
    });
    const binding = findTemporalResource(
      resources,
      "ClusterRoleBinding",
      "temporal-worker-audit-reader",
    );
    const parsed = z
      .object({
        roleRef: z.object({ kind: z.string(), name: z.string() }),
        subjects: z.array(
          z.object({
            kind: z.string(),
            name: z.string(),
            namespace: z.string(),
          }),
        ),
      })
      .parse(binding);
    expect(parsed.roleRef).toMatchObject({
      kind: "ClusterRole",
      name: role.metadata.name,
    });
    expect(parsed.subjects).toContainEqual({
      kind: "ServiceAccount",
      name: "temporal-infra-worker",
      namespace: "temporal",
    });
  });
});
