import { describe, expect, it } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createFliptChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/flipt.ts";
import { createEnvironmentValidationScript } from "@shepherdjerred/homelab/cdk8s/src/resources/flipt/index.ts";

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

async function run(command: string[]): Promise<number> {
  const subprocess = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  return subprocess.exited;
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
    expect(yaml).toContain("path: /var/opt/flipt/data-beta");
    expect(yaml).toContain("path: /var/opt/flipt/data-prod");
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

  it("validates beta and prod without referencing the legacy repository", () => {
    const deployment = DeploymentSchema.parse(
      findManifest(synthesize(), "Deployment", "flipt"),
    );
    const validator = deployment.spec.template.spec.initContainers.find(
      (container) => container.name === "validate-environments",
    );
    expect(validator?.command).toEqual(["/bin/sh", "-c"]);
    const script = validator?.args?.[0] ?? "";
    expect(script).toContain('validate_repo "/var/opt/flipt/data-beta"');
    expect(script).toContain('validate_repo "/var/opt/flipt/data-prod"');
    expect(script).not.toContain("cp -a");
    expect(script).not.toContain('validate_repo "/var/opt/flipt/data"');
    expect(validator?.volumeMounts?.map((mount) => mount.mountPath)).toContain(
      "/var/opt/flipt",
    );
  });

  it("fails fast for missing or partial managed repositories", async () => {
    const root = `/tmp/flipt-validation-test-${crypto.randomUUID()}`;
    expect(await run(["mkdir", "-p", root])).toBe(0);
    expect(
      await run(["/bin/sh", "-c", createEnvironmentValidationScript(root)]),
    ).not.toBe(0);

    expect(
      await run([
        "mkdir",
        "-p",
        `${root}/data-beta/objects`,
        `${root}/data-prod`,
      ]),
    ).toBe(0);
    await Bun.write(`${root}/data-beta/HEAD`, "ref: refs/heads/main\n");
    await Bun.write(`${root}/data-beta/config`, "[core]\n\tbare = true\n");
    expect(
      await run(["/bin/sh", "-c", createEnvironmentValidationScript(root)]),
    ).not.toBe(0);

    expect(await run(["mkdir", "-p", `${root}/data-prod/objects`])).toBe(0);
    await Bun.write(`${root}/data-prod/HEAD`, "ref: refs/heads/main\n");
    await Bun.write(`${root}/data-prod/config`, "[core]\n\tbare = true\n");
    expect(
      await run(["/bin/sh", "-c", createEnvironmentValidationScript(root)]),
    ).toBe(0);
    expect(await run(["rm", "-rf", root])).toBe(0);
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
