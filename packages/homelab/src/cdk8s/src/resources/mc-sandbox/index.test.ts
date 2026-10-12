import { describe, expect, it } from "vitest";
import { App } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createMcSandboxChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/mc-sandbox.ts";
import {
  MC_HARNESS_EXPIRES_AT_ANNOTATION,
  MC_SANDBOX_MAX_DEADLINE_SECONDS,
  mcSandboxImageAllowlist,
} from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/constants.ts";
import { MC_SANDBOX_QUOTA } from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/limits.ts";
import { MC_SANDBOX_POD_GUARD_POLICY } from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/pod-guard.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const ManifestSchema = z
  .object({
    kind: z.string(),
    metadata: z
      .object({
        name: z.string(),
        namespace: z.string().optional(),
        labels: z.record(z.string(), z.string()).optional(),
      })
      .loose(),
  })
  .loose();
type Manifest = z.infer<typeof ManifestSchema>;

function manifests(): Manifest[] {
  const app = new App({ outdir: ".test-synth-mc-sandbox" });
  createMcSandboxChart(app);
  return app
    .synthYaml()
    .split(/^---$/m)
    .map((document) => document.trim())
    .filter((document) => document.length > 0)
    .map((document) => ManifestSchema.parse(parseYaml(document)));
}

function find(kind: string, name: string, namespace?: string): Manifest {
  const found = manifests().find(
    (manifest) =>
      manifest.kind === kind &&
      manifest.metadata.name === name &&
      (namespace === undefined || manifest.metadata.namespace === namespace),
  );
  if (found === undefined) {
    throw new Error(`${kind} ${namespace ?? ""}/${name} not synthesized`);
  }
  return found;
}

const RuleSchema = z.object({
  apiGroups: z.array(z.string()),
  resources: z.array(z.string()),
  verbs: z.array(z.string()),
  resourceNames: z.array(z.string()).optional(),
});
const RoleSchema = z.object({ rules: z.array(RuleSchema) }).loose();

function rules(namespace: string): z.infer<typeof RuleSchema>[] {
  return RoleSchema.parse(find("Role", "mc-harness", namespace)).rules;
}

describe("mc-sandbox chart", () => {
  it("enforces the restricted pod security profile", () => {
    const labels = find("Namespace", "mc-sandbox").metadata.labels ?? {};
    for (const mode of ["enforce", "audit", "warn"]) {
      expect(labels[`pod-security.kubernetes.io/${mode}`]).toBe("restricted");
    }
  });

  it("gives the harness identity and default account no token", () => {
    for (const name of ["mc-harness", "default"]) {
      expect(
        z
          .object({ automountServiceAccountToken: z.boolean() })
          .loose()
          .parse(find("ServiceAccount", name, "mc-sandbox"))
          .automountServiceAccountToken,
      ).toBe(false);
    }
  });

  it("caps the namespace with a canonical-quantity quota", () => {
    const quota = z
      .object({ spec: z.object({ hard: z.record(z.string(), z.string()) }) })
      .loose()
      .parse(find("ResourceQuota", "mc-sandbox-quota", "mc-sandbox"));
    expect(quota.spec.hard).toEqual(MC_SANDBOX_QUOTA);
    for (const value of Object.values(quota.spec.hard)) {
      expect(value).not.toMatch(/000m$/);
    }
  });

  it("lets the harness run and reach sandbox pods", () => {
    const sandbox = rules("mc-sandbox");
    const verbsFor = (resource: string) =>
      sandbox
        .filter((rule) => rule.resources.includes(resource))
        .flatMap((rule) => rule.verbs);
    expect(verbsFor("pods").sort()).toEqual(
      ["create", "delete", "get", "list", "watch"].sort(),
    );
    expect(verbsFor("pods/exec")).toEqual(["create"]);
    expect(verbsFor("pods/portforward")).toEqual(["create"]);
    expect(verbsFor("pods/log")).toEqual(["get"]);
  });

  it("never lets the harness mutate the live server", () => {
    const live = rules("minecraft-tsmc");
    const verbs = new Set(live.flatMap((rule) => rule.verbs));
    for (const forbidden of ["patch", "update", "delete", "deletecollection"]) {
      expect(verbs.has(forbidden)).toBe(false);
    }
    expect(
      live.find((rule) => rule.resources.includes("statefulsets")),
    ).toEqual({
      apiGroups: ["apps"],
      resources: ["statefulsets"],
      verbs: ["get"],
      resourceNames: ["minecraft-tsmc"],
    });
    const podAccess = live.find((rule) =>
      rule.resources.includes("pods/portforward"),
    );
    expect(podAccess?.resourceNames).toEqual(["minecraft-tsmc-0"]);
    expect(podAccess?.verbs).toEqual(["create"]);
  });

  it("lets the harness take and read Velero backups only", () => {
    expect(rules("velero")).toEqual([
      {
        apiGroups: ["velero.io"],
        resources: ["backups"],
        verbs: ["create", "get", "list"],
      },
    ]);
  });

  it("binds every role to the impersonated service account", () => {
    for (const namespace of ["mc-sandbox", "minecraft-tsmc", "velero"]) {
      const binding = z
        .object({
          subjects: z.array(
            z.object({
              kind: z.string(),
              name: z.string(),
              namespace: z.string(),
            }),
          ),
        })
        .loose()
        .parse(find("RoleBinding", "mc-harness", namespace));
      expect(binding.subjects).toEqual([
        { kind: "ServiceAccount", name: "mc-harness", namespace: "mc-sandbox" },
      ]);
    }
  });

  it("guards sandbox pod shape with a fail-closed admission policy", () => {
    const policy = z
      .object({
        spec: z.object({
          failurePolicy: z.string(),
          validations: z.array(z.object({ expression: z.string() }).loose()),
        }),
      })
      .loose()
      .parse(find("ValidatingAdmissionPolicy", MC_SANDBOX_POD_GUARD_POLICY));
    expect(policy.spec.failurePolicy).toBe("Fail");
    const expressions = policy.spec.validations
      .map((validation) => validation.expression)
      .join("\n");
    expect(expressions).toContain("'mc-harness'");
    expect(expressions).toContain(MC_HARNESS_EXPIRES_AT_ANNOTATION);
    expect(expressions).toContain(
      `activeDeadlineSeconds <= ${MC_SANDBOX_MAX_DEADLINE_SECONDS.toString()}`,
    );
    expect(expressions).toContain("'batch-low'");
    expect(expressions).toContain("'liskov'");
    expect(expressions).toContain("persistentVolumeClaim");
    for (const image of mcSandboxImageAllowlist()) {
      expect(expressions).toContain(`'${image}'`);
    }
    const binding = z
      .object({
        spec: z.object({
          policyName: z.string(),
          validationActions: z.array(z.string()),
        }),
      })
      .loose()
      .parse(
        find("ValidatingAdmissionPolicyBinding", MC_SANDBOX_POD_GUARD_POLICY),
      );
    expect(binding.spec).toEqual({
      policyName: MC_SANDBOX_POD_GUARD_POLICY,
      validationActions: ["Deny"],
    });
  });

  it("allows exactly the catalog-pinned server images", () => {
    expect(mcSandboxImageAllowlist()).toEqual([
      `itzg/minecraft-server:${versions["itzg/minecraft-server"]}`,
      `docker.io/itzg/minecraft-server:${versions["itzg/minecraft-server"]}`,
      `ghcr.io/shepherdjerred/the-storm-server:${versions["shepherdjerred/the-storm-server"]}`,
      `ghcr.io/shepherdjerred/the-storm-server:${versions["shepherdjerred/the-storm-server/prod"]}`,
    ]);
    for (const image of mcSandboxImageAllowlist()) {
      expect(image).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
  });
});
