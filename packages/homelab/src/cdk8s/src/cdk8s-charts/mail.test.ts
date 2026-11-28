import { beforeEach, describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { applyApplicationReleasePolicy } from "@shepherdjerred/homelab/cdk8s/src/application-release-policy.ts";
import { createMailChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/mail.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { createPrometheusApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/prometheus.ts";
import {
  createCertManagerApp,
  HOMELAB_CLUSTER_CA_FILE,
  HOMELAB_CLUSTER_ISSUER_NAME,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/cert-manager.ts";
import {
  ALERTMANAGER_MAIL_SMTP_CA_MOUNT_PATH,
  ALERTMANAGER_MAIL_SMTP_CA_SECRET,
  MAIL_SMTP_DNS_NAMES,
  MAIL_SMTP_TLS_MOUNT_PATH,
  MAIL_SMTP_TLS_SECRET,
  MAIL_SMTP_TLS_SERVER_NAME,
} from "@shepherdjerred/homelab/cdk8s/src/resources/mail/mail-smtp.ts";

const RenderedObjectSchema = z.looseObject({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.looseObject({ name: z.string() }),
  spec: z.record(z.string(), z.unknown()).optional(),
});

function renderActiveMailByKind() {
  const parsed = z
    .array(RenderedObjectSchema)
    .parse(createMailChart(new App(), true).toJson());
  return {
    all: parsed,
    one: (kind: string, name?: string) =>
      parsed.find(
        (entry) =>
          entry.kind === kind &&
          (name === undefined || entry.metadata.name === name),
      ),
  };
}

describe("createMailChart", () => {
  beforeEach(() => {
    resetProbeRegistry();
  });

  it("emits only the inactive ConfigMap marker when disabled", () => {
    const inactive = createMailChart(new App(), false).toJson();
    expect(inactive).toEqual([
      expect.objectContaining({
        kind: "ConfigMap",
        data: { active: "false" },
      }),
    ]);
  });

  it("renders SQLite volume, 1Password credentials, STARTTLS leaf certificate, ports, caller ingress, and Fastmail :587 egress", () => {
    const rendered = renderActiveMailByKind();

    expect(rendered.one("OnePasswordItem")?.spec).toEqual({
      itemPath: expect.stringContaining("/items/mail-secrets"),
    });

    expect(
      rendered.one("Certificate", MAIL_SMTP_TLS_SECRET)?.spec,
    ).toMatchObject({
      secretName: MAIL_SMTP_TLS_SECRET,
      commonName: "mail.mail.svc.cluster.local",
      dnsNames: MAIL_SMTP_DNS_NAMES,
      issuerRef: { name: "homelab-ca-issuer", kind: "ClusterIssuer" },
      privateKey: { rotationPolicy: "Always" },
    });

    expect(rendered.one("PersistentVolumeClaim")?.spec).toMatchObject({
      resources: { requests: { storage: "2Gi" } },
    });

    const podSpec = z
      .object({
        strategy: z.object({ type: z.string() }),
        template: z.object({
          spec: z.object({
            automountServiceAccountToken: z.boolean(),
            securityContext: z.object({ fsGroup: z.number() }),
            containers: z.array(
              z.object({
                name: z.string(),
                ports: z.array(
                  z.object({ name: z.string(), containerPort: z.number() }),
                ),
                volumeMounts: z.array(
                  z.object({
                    mountPath: z.string(),
                    readOnly: z.boolean().optional(),
                  }),
                ),
              }),
            ),
          }),
        }),
      })
      .parse(rendered.one("Deployment")?.spec);

    expect(podSpec.strategy.type).toBe("Recreate");
    expect(podSpec.template.spec.automountServiceAccountToken).toBe(false);
    expect(podSpec.template.spec.securityContext.fsGroup).toBe(1000);
    const mailContainer = podSpec.template.spec.containers[0];
    expect(mailContainer?.name).toBe("mail");
    expect(mailContainer?.ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "http", containerPort: 7370 }),
        expect.objectContaining({ name: "api", containerPort: 7371 }),
        expect.objectContaining({ name: "smtp", containerPort: 25 }),
      ]),
    );
    expect(mailContainer?.volumeMounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mountPath: "/var/lib/mail" }),
        expect.objectContaining({
          mountPath: MAIL_SMTP_TLS_MOUNT_PATH,
          readOnly: true,
        }),
      ]),
    );

    expect(rendered.one("Service", "mail")?.spec).toMatchObject({
      ports: expect.arrayContaining([
        expect.objectContaining({ name: "http", port: 7370 }),
        expect.objectContaining({ name: "api", port: 7371 }),
        expect.objectContaining({ name: "smtp", port: 25 }),
      ]),
    });

    expect(rendered.one("Ingress")?.spec).toMatchObject({
      defaultBackend: { service: { name: "mail", port: { number: 7370 } } },
      tls: [{ hosts: ["mail"] }],
    });

    expect(
      rendered.one("NetworkPolicy", "mail-app-netpol")?.spec,
    ).toMatchObject({
      ingress: expect.arrayContaining([
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "alert-dashboard",
                },
              },
            },
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "errors",
                },
              },
            },
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "media" },
              },
              podSelector: { matchLabels: { component: "media-network" } },
            },
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "temporal" },
              },
              podSelector: { matchLabels: { component: "reports-worker" } },
            },
          ],
          ports: [{ port: 7371, protocol: "TCP" }],
        },
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "storm-forum" },
              },
              podSelector: {
                matchLabels: { app: "storm-forum", component: "web" },
              },
            },
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "storm-forum" },
              },
              podSelector: {
                matchLabels: { app: "storm-forum", component: "release" },
              },
            },
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "storm-forum-beta",
                },
              },
              podSelector: {
                matchLabels: { app: "storm-forum", component: "web" },
              },
            },
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "storm-forum-beta",
                },
              },
              podSelector: {
                matchLabels: { app: "storm-forum", component: "release" },
              },
            },
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "media" },
              },
            },
          ],
          ports: [{ port: 25, protocol: "TCP" }],
        },
      ]),
      egress: expect.arrayContaining([
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: 587, protocol: "TCP" }],
        },
      ]),
    });
  });
});

describe("Alertmanager mail SMTP TLS", () => {
  beforeEach(() => {
    resetProbeRegistry();
  });

  it("configures Alertmanager STARTTLS against mail.mail.svc.cluster.local:25 with the cluster CA", async () => {
    const app = new App({ outdir: ".test-synth-alertmanager-mail-smtp-tls" });
    const chart = new Chart(app, "apps", {
      namespace: "argocd",
      disableResourceNameHashes: true,
    });
    createCertManagerApp(chart);
    await createPrometheusApp(chart);
    applyApplicationReleasePolicy(app);

    const resources = parseAllDocuments(app.synthYaml()).flatMap((doc) => {
      const parsed = RenderedObjectSchema.safeParse(doc.toJSON());
      return parsed.success ? [parsed.data] : [];
    });
    const find = (kind: string, name: string) =>
      resources.find((r) => r.kind === kind && r.metadata.name === name);

    expect(find("Certificate", "homelab-cluster-ca")?.spec).toMatchObject({
      isCA: true,
      privateKey: { rotationPolicy: "Never" },
    });
    expect(
      find("ClusterIssuer", HOMELAB_CLUSTER_ISSUER_NAME)?.metadata,
    ).not.toHaveProperty("namespace");

    const trust = find("Certificate", ALERTMANAGER_MAIL_SMTP_CA_SECRET);
    expect(trust?.metadata).toMatchObject({ namespace: "prometheus" });
    expect(trust?.spec).toMatchObject({
      secretName: ALERTMANAGER_MAIL_SMTP_CA_SECRET,
      issuerRef: { name: "homelab-ca-issuer", kind: "ClusterIssuer" },
    });

    const prometheusApp = find("Application", "prometheus");
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
                      `${MAIL_SMTP_TLS_SERVER_NAME}:25`,
                    ),
                    smtp_tls_config: z.object({
                      ca_file: z.literal(
                        `${ALERTMANAGER_MAIL_SMTP_CA_MOUNT_PATH}/${HOMELAB_CLUSTER_CA_FILE}`,
                      ),
                      server_name: z.literal(MAIL_SMTP_TLS_SERVER_NAME),
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
      .parse(prometheusApp?.spec).source.helm.valuesObject.alertmanager;

    expect(alertmanager.alertmanagerSpec.secrets).toEqual(
      expect.arrayContaining([
        "alertmanager-mail-smtp",
        ALERTMANAGER_MAIL_SMTP_CA_SECRET,
      ]),
    );
  }, 60_000);
});
