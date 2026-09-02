import { describe, expect, it } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createFliptChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/flipt.ts";
import { createEnvironmentInitializationScript } from "@shepherdjerred/homelab/cdk8s/src/resources/flipt/index.ts";

const ManifestSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
  })
  .loose();

const ContainerSchema = z
  .object({
    name: z.string(),
    image: z.string(),
    command: z.array(z.string()).optional(),
    args: z.array(z.string()).optional(),
    volumeMounts: z
      .array(z.object({ name: z.string(), mountPath: z.string() }).loose())
      .optional(),
    securityContext: z
      .object({
        runAsUser: z.number().optional(),
        runAsGroup: z.number().optional(),
        readOnlyRootFilesystem: z.boolean().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const DeploymentSchema = z
  .object({
    spec: z.object({
      template: z.object({
        metadata: z
          .object({ annotations: z.record(z.string(), z.string()) })
          .loose(),
        spec: z
          .object({
            containers: z.array(ContainerSchema),
            initContainers: z.array(ContainerSchema),
          })
          .loose(),
      }),
    }),
  })
  .loose();

const ConfigMapSchema = z
  .object({ data: z.record(z.string(), z.string()) })
  .loose();

function synthesize(): unknown[] {
  const app = new App();
  createFliptChart(app);
  return z.array(z.unknown()).parse(app.charts.at(0)?.toJson());
}

function findManifest(
  manifests: unknown[],
  kind: string,
  name: string,
): unknown {
  const manifest = manifests.find((candidate) => {
    const parsed = ManifestSchema.safeParse(candidate);
    return (
      parsed.success &&
      parsed.data.kind === kind &&
      parsed.data.metadata.name === name
    );
  });
  if (manifest === undefined)
    throw new Error(`Missing ${kind}/${name} manifest`);
  return manifest;
}

describe("Flipt chart", () => {
  it("emits the namespace, deployment, config, storage, service, and policy resources", () => {
    const manifests = synthesize();
    const names = new Set(
      manifests.map((manifest) => {
        const parsed = ManifestSchema.parse(manifest);
        return `${parsed.kind}/${parsed.metadata.name}`;
      }),
    );

    expect(names).toContain("Namespace/flipt");
    expect(names).toContain("Deployment/flipt");
    expect(names).toContain("ConfigMap/flipt-flipt-config");
    expect(names).toContain("ConfigMap/flipt-flipt-seed");
    expect(names).toContain("PersistentVolumeClaim/flipt-data");
    expect(names).toContain("Service/flipt-flipt-service");
    expect(names).toContain("NetworkPolicy/flipt-ingress-netpol");
    expect(names).toContain("NetworkPolicy/flipt-egress-netpol");
  });

  it("restates the full command because the image declares no entrypoint", () => {
    // flipt/flipt ships ENTRYPOINT null + CMD ["/flipt","server"], so supplying
    // only args would make Kubernetes try to exec "--config" as the binary.
    const deployment = DeploymentSchema.parse(
      findManifest(synthesize(), "Deployment", "flipt"),
    );
    const container = deployment.spec.template.spec.containers.at(0);
    expect(container?.command).toEqual([
      "/flipt",
      "server",
      "--config",
      "/etc/flipt/config.yml",
    ]);
  });

  it("runs as the image's own uid 100 / gid 1000", () => {
    // The flipt user is uid 100, not the 1000 used by our first-party images,
    // and /var/opt/flipt ships owned by it. Running as 1000 cannot write the
    // git repo.
    const deployment = DeploymentSchema.parse(
      findManifest(synthesize(), "Deployment", "flipt"),
    );
    const security =
      deployment.spec.template.spec.containers.at(0)?.securityContext;
    expect(security?.runAsUser).toBe(100);
    expect(security?.runAsGroup).toBe(1000);
    expect(security?.readOnlyRootFilesystem).toBe(true);
  });

  it("configures durable local storage rather than the in-memory default", () => {
    // Flipt v2 defaults to in-memory storage: without an explicit local backend
    // it accepts flag writes and silently loses them on restart. This assertion
    // is the guard against that config being dropped.
    const config = ConfigMapSchema.parse(
      findManifest(synthesize(), "ConfigMap", "flipt-flipt-config"),
    );
    const yaml = config.data["config.yml"] ?? "";
    expect(yaml).toContain('version: "2.0"');
    expect(yaml).toContain("type: local");
    expect(yaml).not.toContain("path: /var/opt/flipt/data\n");
    expect(yaml).not.toContain("path: /var/opt/flipt/data-beta");
    expect(yaml).not.toContain("path: /var/opt/flipt/data-prod");
    expect(yaml).toContain("path: /var/opt/flipt/environments/beta");
    expect(yaml).toContain("path: /var/opt/flipt/environments/prod");
    expect(yaml).toContain("name: beta");
    expect(yaml).toContain("name: prod");
    expect(yaml).toMatch(/prod:\n {4}name: prod\n {4}default: true/);
    // Both default to true and would fail continuously against DNS-only egress.
    expect(yaml).toContain("check_for_updates: false");
    expect(yaml).toContain("telemetry_enabled: false");
  });

  it("restarts when the complete Flipt configuration changes", () => {
    const deployment = DeploymentSchema.parse(
      findManifest(synthesize(), "Deployment", "flipt"),
    );
    expect(
      deployment.spec.template.metadata.annotations["config-hash"],
    ).toMatch(/^[a-f\d]{12}$/);
  });

  it("validates and initializes both environments without overwriting repositories", () => {
    const deployment = DeploymentSchema.parse(
      findManifest(synthesize(), "Deployment", "flipt"),
    );
    const initializer = deployment.spec.template.spec.initContainers.find(
      (container) => container.name === "initialize-environments",
    );
    expect(initializer?.command).toEqual(["/bin/sh", "-c"]);
    const script = initializer?.args?.[0] ?? "";
    expect(script).toContain('/flipt validate --work-dir "$seed"');
    expect(script).toContain('repo="/var/opt/flipt/environments/$environment"');
    expect(script).toContain(
      'cp "/etc/flipt-seed/beta.scout.yaml" "$work_root/beta/scout/features.yaml"',
    );
    expect(script).toContain('if [ ! -e "$repo" ]');
    expect(script).not.toContain("data-beta");
    expect(script).not.toContain("data-prod");
    expect(initializer?.volumeMounts?.map((mount) => mount.mountPath)).toEqual(
      expect.arrayContaining(["/var/opt/flipt", "/etc/flipt-seed", "/tmp"]),
    );
  });

  it("seeds every product namespace into both environments", () => {
    const seed = ConfigMapSchema.parse(
      findManifest(synthesize(), "ConfigMap", "flipt-flipt-seed"),
    );
    expect(Object.keys(seed.data).toSorted()).toEqual(
      ["beta", "prod"]
        .flatMap((environment) =>
          [
            "scout",
            "birmel",
            "streambot",
            "starlight-karma-bot",
            "trmnl-dashboard",
            "temporal",
          ].map((namespace) => `${environment}.${namespace}.yaml`),
        )
        .toSorted(),
    );
    for (const [filename, yaml] of Object.entries(seed.data)) {
      const namespace = filename.split(".")[1];
      if (namespace === undefined) {
        throw new Error(`seed filename has no namespace: ${filename}`);
      }
      expect(yaml).toContain(`key: ${namespace}`);
      expect(yaml).not.toContain("key: default");
    }
  });

  it("generates a fail-fast initialization script", () => {
    const script = createEnvironmentInitializationScript("/data", ["scout"]);
    expect(script).toContain('validate_repo "$repo"');
    expect(script).toContain('/flipt validate --work-dir "$repo"');
    expect(script).toContain('repo="/data/environments/$environment"');
    expect(script).toContain(
      'cp "/etc/flipt-seed/prod.scout.yaml" "$work_root/prod/scout/features.yaml"',
    );
    expect(script).not.toContain("data-beta");
    expect(script).not.toContain("data-prod");
  });

  it("restricts egress to DNS only", () => {
    const policy = z
      .object({
        spec: z.object({
          policyTypes: z.array(z.string()),
          egress: z.array(z.unknown()),
        }),
      })
      .loose()
      .parse(
        findManifest(synthesize(), "NetworkPolicy", "flipt-egress-netpol"),
      );
    expect(policy.spec.policyTypes).toEqual(["Egress"]);
    // A single rule: kube-dns. Storage is local, there is no remote git sync,
    // and update checks and telemetry are off, so nothing else is legitimate.
    expect(policy.spec.egress).toHaveLength(1);
  });

  it("allows the Temporal repo worker to read the managed snapshot", () => {
    const policy = z
      .object({
        spec: z.object({
          ingress: z.array(z.unknown()),
        }),
      })
      .loose()
      .parse(
        findManifest(synthesize(), "NetworkPolicy", "flipt-ingress-netpol"),
      );
    expect(policy.spec.ingress).toContainEqual(
      expect.objectContaining({
        from: expect.arrayContaining([
          {
            namespaceSelector: {
              matchLabels: { "kubernetes.io/metadata.name": "temporal" },
            },
          },
        ]),
      }),
    );
  });
});
