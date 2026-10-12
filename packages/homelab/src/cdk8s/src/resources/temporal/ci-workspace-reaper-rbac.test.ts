import { App, Chart } from "cdk8s";
import { ServiceAccount } from "cdk8s-plus-31";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CI_WORKSPACE_REAPER_ROLE,
  createTemporalWorkerCiWorkspaceReaperRbac,
} from "./ci-workspace-reaper-rbac.ts";

const ManifestSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string(), namespace: z.string() }).loose(),
  })
  .loose();
const RoleSchema = z.object({
  rules: z.array(
    z.object({
      apiGroups: z.array(z.string()),
      resources: z.array(z.string()),
      verbs: z.array(z.string()),
    }),
  ),
});
const BindingSchema = z.object({
  roleRef: z.object({ kind: z.string(), name: z.string() }),
  subjects: z.array(
    z.object({ kind: z.string(), name: z.string(), namespace: z.string() }),
  ),
});

describe("CI workspace reaper RBAC", () => {
  it("grants the infra worker only list and delete on CI pods and claims", () => {
    const app = new App();
    const chart = new Chart(app, "temporal", { namespace: "temporal" });
    const infra = new ServiceAccount(chart, "infra", {
      metadata: { name: "temporal-infra-worker" },
    });
    createTemporalWorkerCiWorkspaceReaperRbac(chart, [infra]);

    const manifests = app.charts
      .flatMap((synthesized) => synthesized.toJson())
      .map((manifest: unknown) => ManifestSchema.parse(manifest));
    const role = manifests.find((manifest) => manifest.kind === "Role");
    const binding = manifests.find(
      (manifest) => manifest.kind === "RoleBinding",
    );

    expect(role?.metadata).toMatchObject({
      name: CI_WORKSPACE_REAPER_ROLE,
      namespace: "woodpecker-ci",
    });
    expect(RoleSchema.parse(role).rules).toEqual([
      {
        apiGroups: [""],
        resources: ["pods", "persistentvolumeclaims"],
        verbs: ["list", "delete"],
      },
    ]);
    expect(binding?.metadata.namespace).toBe("woodpecker-ci");
    expect(BindingSchema.parse(binding)).toMatchObject({
      roleRef: { kind: "Role", name: CI_WORKSPACE_REAPER_ROLE },
      subjects: [
        {
          kind: "ServiceAccount",
          name: "temporal-infra-worker",
          namespace: "temporal",
        },
      ],
    });
  });
});
