import { beforeEach, describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createBugsinkChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/bugsink.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";

const RenderedSchema = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({
    name: z.string(),
    namespace: z.string().optional(),
    annotations: z.record(z.string(), z.string()).optional(),
  }),
  spec: z.record(z.string(), z.unknown()).optional(),
});

const BugsinkDeploymentSpecSchema = z.object({
  template: z.object({
    spec: z.object({
      volumes: z.array(
        z.looseObject({
          name: z.string(),
          secret: z
            .object({
              secretName: z.string(),
              items: z
                .array(z.object({ key: z.string(), path: z.string() }))
                .optional(),
            })
            .optional(),
        }),
      ),
      containers: z.array(
        z.object({
          name: z.string(),
          args: z.array(z.string()),
          env: ContainerEnvSchema,
          volumeMounts: z.array(
            z.object({
              name: z.string(),
              mountPath: z.string(),
              readOnly: z.boolean().optional(),
            }),
          ),
        }),
      ),
    }),
  }),
});

beforeEach(resetProbeRegistry);

function synthesizeBugsink() {
  const app = new App();
  createBugsinkChart(app);
  return z.array(RenderedSchema).parse(app.charts.at(0)?.toJson());
}

describe("Bugsink STARTTLS SMTP configuration", () => {
  test("issues bugsink-smtp-ca at sync-wave -1 and projects only ca.crt into both runtime containers", () => {
    const manifests = synthesizeBugsink();

    const certificate = manifests.find(
      (item) =>
        item.kind === "Certificate" && item.metadata.name === "bugsink-smtp-ca",
    );
    expect(certificate?.metadata).toMatchObject({
      name: "bugsink-smtp-ca",
      namespace: "bugsink",
      annotations: { "argocd.argoproj.io/sync-wave": "-1" },
    });
    expect(certificate?.spec).toMatchObject({
      secretName: "bugsink-smtp-ca",
      commonName: "bugsink-smtp-ca",
      dnsNames: ["bugsink.bugsink.svc.cluster.local"],
      issuerRef: { name: "homelab-ca-issuer", kind: "ClusterIssuer" },
    });

    const deployment = manifests.find((item) => item.kind === "Deployment");
    const podSpec = BugsinkDeploymentSpecSchema.parse(deployment?.spec).template
      .spec;

    const caVolume = podSpec.volumes.find(
      (vol) => vol.secret?.secretName === "bugsink-smtp-ca",
    );
    expect(caVolume?.secret?.items).toEqual([
      { key: "ca.crt", path: "ca.crt" },
    ]);

    expect(podSpec.containers.map((c) => c.name)).toEqual([
      "bugsink",
      "snappea-worker",
    ]);

    for (const [containerName, expectedExec] of [
      ["bugsink", "exec bugsink-manage runserver 0.0.0.0:8000"],
      ["snappea-worker", "exec bugsink-manage runsnappea"],
    ] as const) {
      const container = podSpec.containers.find(
        (item) => item.name === containerName,
      );
      expect(container?.args).toEqual([
        `cat /usr/lib/ssl/cert.pem /etc/bugsink/smtp-ca/ca.crt > /tmp/combined-ca-bundle.pem.$$ && mv /tmp/combined-ca-bundle.pem.$$ /tmp/combined-ca-bundle.pem && ${expectedExec}`,
      ]);
      expect(container?.volumeMounts).toContainEqual({
        name: caVolume?.name,
        mountPath: "/etc/bugsink/smtp-ca",
        readOnly: true,
      });

      const envByName = new Map(
        container?.env.map((entry) => [entry.name, entry]),
      );
      expect(envByName.get("SSL_CERT_FILE")?.value).toBe(
        "/tmp/combined-ca-bundle.pem",
      );
      expect(envByName.get("EMAIL_HOST")?.value).toBe(
        "mail.mail.svc.cluster.local",
      );
      expect(envByName.get("EMAIL_PORT")?.value).toBe("25");
      expect(envByName.get("EMAIL_USE_TLS")?.value).toBe("True");
      expect(envByName.get("EMAIL_USE_SSL")?.value).toBe("False");
      expect(
        envByName.get("EMAIL_HOST_USER")?.valueFrom?.secretKeyRef,
      ).toMatchObject({ key: "MAIL_SMTP_USERNAME" });
      expect(
        envByName.get("EMAIL_HOST_PASSWORD")?.valueFrom?.secretKeyRef,
      ).toMatchObject({ key: "MAIL_SMTP_PASSWORD" });
    }
  });

  test("permits SMTP egress only to mail:25 and removes legacy Postal selectors", () => {
    const manifests = synthesizeBugsink();
    const netpol = manifests.find(
      (item) =>
        item.kind === "NetworkPolicy" &&
        item.metadata.name === "bugsink-netpol",
    );
    expect(netpol?.spec).toMatchObject({
      egress: expect.arrayContaining([
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "mail" },
              },
              podSelector: { matchLabels: { app: "mail" } },
            },
          ],
          ports: [{ port: 25, protocol: "TCP" }],
        },
      ]),
    });
    expect(JSON.stringify(manifests)).not.toContain("postal");
  });
});
