import { beforeEach, describe, expect, it } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createMailChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/mail.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import {
  MAIL_SMTP_TLS_MOUNT_PATH,
  MAIL_SMTP_TLS_SECRET,
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

  it("renders SQLite volume, 1Password credentials, STARTTLS leaf certificate, ports, and Fastmail :587 egress", () => {
    const rendered = renderActiveMailByKind();

    expect(rendered.one("OnePasswordItem")?.spec).toEqual({
      itemPath: expect.stringContaining("/items/mail-secrets"),
    });

    expect(
      rendered.one("Certificate", MAIL_SMTP_TLS_SECRET)?.spec,
    ).toMatchObject({
      secretName: MAIL_SMTP_TLS_SECRET,
      commonName: "mail.mail.svc.cluster.local",
      issuerRef: { name: "homelab-ca-issuer", kind: "ClusterIssuer" },
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
      egress: expect.arrayContaining([
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: 587, protocol: "TCP" }],
        },
      ]),
    });
  });
});
