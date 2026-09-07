import { App, Chart } from "cdk8s";
import { describe, expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createPostalChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/postal.ts";
import { applyApplicationReleasePolicy } from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import {
  createCertManagerApp,
  HOMELAB_CLUSTER_CA_FILE,
  HOMELAB_CLUSTER_ISSUER_NAME,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/cert-manager.ts";
import { createPrometheusApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/prometheus.ts";
import {
  ALERTMANAGER_POSTAL_SMTP_CA_MOUNT_PATH,
  ALERTMANAGER_POSTAL_SMTP_CA_SECRET,
  POSTAL_SMTP_TLS_CERTIFICATE_PATH,
  POSTAL_SMTP_TLS_MOUNT_PATH,
  POSTAL_SMTP_TLS_PRIVATE_KEY_PATH,
  POSTAL_SMTP_TLS_SECRET,
  POSTAL_SMTP_TLS_SERVER_NAME,
} from "@shepherdjerred/homelab/cdk8s/src/resources/mail/postal-smtp.ts";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";

const ResourceSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
    spec: z.unknown().optional(),
  })
  .loose();

type Resource = z.infer<typeof ResourceSchema>;

function resourcesFrom(yaml: string): Resource[] {
  return parseAllDocuments(yaml).flatMap((document) => {
    const parsed = ResourceSchema.safeParse(document.toJSON());
    return parsed.success ? [parsed.data] : [];
  });
}

function findResource(
  resources: readonly Resource[],
  kind: string,
  name: string,
): Resource {
  const resource = resources.find(
    (candidate) => candidate.kind === kind && candidate.metadata.name === name,
  );
  if (resource === undefined) {
    throw new Error(`Missing ${kind} ${name}`);
  }
  return resource;
}

function synthesizePostal(): Resource[] {
  const app = new App({ outdir: ".test-synth-postal-smtp-tls" });
  createPostalChart(app);
  return resourcesFrom(app.synthYaml());
}

const VolumeMountSchema = z.object({
  name: z.string(),
  mountPath: z.string(),
  readOnly: z.boolean().optional(),
});

const ContainerSchema = z.object({
  name: z.string(),
  env: ContainerEnvSchema,
  volumeMounts: z.array(VolumeMountSchema).optional(),
});

const DeploymentSpecSchema = z.object({
  template: z.object({
    spec: z.object({
      securityContext: z.object({ fsGroup: z.number().optional() }).optional(),
      containers: z.array(ContainerSchema),
    }),
  }),
});

describe("Postal SMTP TLS", () => {
  test("issues a rotating leaf for every in-cluster SMTP hostname", () => {
    const certificate = findResource(
      synthesizePostal(),
      "Certificate",
      POSTAL_SMTP_TLS_SECRET,
    );
    const spec = z
      .object({
        secretName: z.literal(POSTAL_SMTP_TLS_SECRET),
        dnsNames: z.array(z.string()),
        issuerRef: z.object({
          name: z.literal("homelab-ca-issuer"),
          kind: z.literal("ClusterIssuer"),
        }),
        privateKey: z.object({ rotationPolicy: z.literal("Always") }),
      })
      .parse(certificate.spec);

    expect(spec.dnsNames).toContain(POSTAL_SMTP_TLS_SERVER_NAME);
    expect(spec.dnsNames).toContain("postal-postal-smtp-service");
    expect(spec.dnsNames).toContain("postal-postal-smtp-service.postal");
  });

  test("enables STARTTLS on the SMTP server from the mounted leaf", () => {
    const synthesized = synthesizePostal();
    const deployment = synthesized.find(
      (resource) =>
        resource.kind === "Deployment" &&
        z
          .object({
            template: z.object({
              spec: z.object({
                containers: z.array(z.object({ name: z.string() })),
              }),
            }),
          })
          .safeParse(resource.spec).success &&
        DeploymentSpecSchema.parse(resource.spec).template.spec.containers.some(
          (container) => container.name === "postal-smtp",
        ),
    );
    if (deployment === undefined) {
      throw new Error("Missing postal-smtp Deployment");
    }
    const spec = DeploymentSpecSchema.parse(deployment.spec);
    const container = spec.template.spec.containers.find(
      (candidate) => candidate.name === "postal-smtp",
    );
    if (container === undefined) {
      throw new Error("Missing postal-smtp container");
    }

    const env = Object.fromEntries(
      container.env.flatMap((entry) =>
        entry.value === undefined ? [] : [[entry.name, entry.value]],
      ),
    );
    expect(env["SMTP_SERVER_TLS_ENABLED"]).toBe("true");
    expect(env["SMTP_SERVER_TLS_CERTIFICATE_PATH"]).toBe(
      POSTAL_SMTP_TLS_CERTIFICATE_PATH,
    );
    expect(env["SMTP_SERVER_TLS_PRIVATE_KEY_PATH"]).toBe(
      POSTAL_SMTP_TLS_PRIVATE_KEY_PATH,
    );
    expect(container.volumeMounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mountPath: POSTAL_SMTP_TLS_MOUNT_PATH,
          readOnly: true,
        }),
      ]),
    );
    expect(spec.template.spec.securityContext?.fsGroup).toBe(1000);
  });
});

describe("Alertmanager Postal SMTP TLS", () => {
  test("requires STARTTLS and validates the cluster CA", async () => {
    const app = new App({ outdir: ".test-synth-alertmanager-postal-smtp-tls" });
    const chart = new Chart(app, "apps", {
      namespace: "argocd",
      disableResourceNameHashes: true,
    });
    createCertManagerApp(chart);
    await createPrometheusApp(chart);
    applyApplicationReleasePolicy(app);
    const resources = resourcesFrom(app.synthYaml());

    const ca = findResource(resources, "Certificate", "homelab-cluster-ca");
    expect(
      z
        .object({
          isCA: z.literal(true),
          privateKey: z.object({ rotationPolicy: z.literal("Never") }),
        })
        .parse(ca.spec),
    ).toMatchObject({ isCA: true });

    const clusterIssuer = findResource(
      resources,
      "ClusterIssuer",
      HOMELAB_CLUSTER_ISSUER_NAME,
    );
    expect(clusterIssuer.metadata).not.toHaveProperty("namespace");

    const trust = findResource(
      resources,
      "Certificate",
      ALERTMANAGER_POSTAL_SMTP_CA_SECRET,
    );
    expect(trust.metadata).toMatchObject({ namespace: "prometheus" });
    expect(
      z
        .object({
          secretName: z.literal(ALERTMANAGER_POSTAL_SMTP_CA_SECRET),
          issuerRef: z.object({
            name: z.literal("homelab-ca-issuer"),
            kind: z.literal("ClusterIssuer"),
          }),
        })
        .parse(trust.spec).secretName,
    ).toBe(ALERTMANAGER_POSTAL_SMTP_CA_SECRET);

    const prometheusApp = findResource(resources, "Application", "prometheus");
    const alertmanager = z
      .object({
        source: z.object({
          helm: z.object({
            valuesObject: z.object({
              alertmanager: z.object({
                config: z.object({
                  global: z.object({
                    smtp_require_tls: z.literal(true),
                    smtp_smarthost: z.literal(
                      `${POSTAL_SMTP_TLS_SERVER_NAME}:25`,
                    ),
                    smtp_tls_config: z.object({
                      ca_file: z.literal(
                        `${ALERTMANAGER_POSTAL_SMTP_CA_MOUNT_PATH}/${HOMELAB_CLUSTER_CA_FILE}`,
                      ),
                      server_name: z.literal(POSTAL_SMTP_TLS_SERVER_NAME),
                      insecure_skip_verify: z.literal(false),
                    }),
                  }),
                }),
                alertmanagerSpec: z.object({
                  secrets: z.array(z.string()),
                }),
              }),
            }),
          }),
        }),
      })
      .parse(prometheusApp.spec).source.helm.valuesObject.alertmanager;

    expect(alertmanager.alertmanagerSpec.secrets).toEqual(
      expect.arrayContaining([ALERTMANAGER_POSTAL_SMTP_CA_SECRET]),
    );
  }, 60_000);
});
