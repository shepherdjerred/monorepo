import { beforeEach, describe, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { createSeerrDeployment } from "./seerr.ts";

beforeEach(resetProbeRegistry);

describe("createSeerrDeployment", () => {
  test("issues seerr-smtp-ca at sync-wave -1 and wires NODE_EXTRA_CA_CERTS", () => {
    const app = new App();
    const chart = new Chart(app, "media", {
      namespace: "media",
      disableResourceNameHashes: true,
    });
    createSeerrDeployment(chart);
    const manifests = chart.toJson();

    expect(manifests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "Certificate",
          metadata: expect.objectContaining({
            name: "seerr-smtp-ca",
            namespace: "media",
            annotations: { "argocd.argoproj.io/sync-wave": "-1" },
          }),
          spec: expect.objectContaining({
            secretName: "seerr-smtp-ca",
            commonName: "seerr-smtp-ca",
            dnsNames: ["seerr.media.svc.cluster.local"],
            issuerRef: { name: "homelab-ca-issuer", kind: "ClusterIssuer" },
          }),
        }),
        expect.objectContaining({
          kind: "Deployment",
          spec: expect.objectContaining({
            template: expect.objectContaining({
              spec: expect.objectContaining({
                volumes: expect.arrayContaining([
                  expect.objectContaining({
                    name: "smtp-ca",
                    secret: expect.objectContaining({
                      secretName: "seerr-smtp-ca",
                      items: [{ key: "ca.crt", path: "ca.crt" }],
                    }),
                  }),
                ]),
                containers: [
                  expect.objectContaining({
                    env: expect.arrayContaining([
                      {
                        name: "NODE_EXTRA_CA_CERTS",
                        value: "/etc/seerr/smtp-ca/ca.crt",
                      },
                    ]),
                    volumeMounts: expect.arrayContaining([
                      {
                        name: "smtp-ca",
                        mountPath: "/etc/seerr/smtp-ca",
                        readOnly: true,
                      },
                    ]),
                  }),
                ],
              }),
            }),
          }),
        }),
      ]),
    );
  });

  test("its egress policy reaches the mail broker's SMTP listener", () => {
    const app = new App();
    const chart = new Chart(app, "media", {
      namespace: "media",
      disableResourceNameHashes: true,
    });
    createSeerrDeployment(chart);

    expect(chart.toJson()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "NetworkPolicy",
          metadata: { name: "seerr-egress-netpol", namespace: "media" },
          spec: expect.objectContaining({
            policyTypes: ["Egress"],
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
          }),
        }),
      ]),
    );
  });
});
