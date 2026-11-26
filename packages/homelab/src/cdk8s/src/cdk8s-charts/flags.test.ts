import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createFlagsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/flags.ts";
import { KUBERNETES_API_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { FLAGS_TAILSCALE_INGRESS } from "@shepherdjerred/homelab/cdk8s/src/resources/flags/ingress.ts";

const Manifest = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({
    name: z.string(),
    namespace: z.string().optional(),
  }),
});

beforeEach(resetProbeRegistry);

test("a prepared service renders only its activation marker", () => {
  const resources = createFlagsChart(new App(), false).toJson();
  expect(resources).toHaveLength(1);
  expect(resources[0]).toMatchObject({
    kind: "ConfigMap",
    data: { active: "false" },
  });
});

test("an activated service renders its workload and evaluation port", () => {
  const manifests = z
    .array(Manifest)
    .parse(createFlagsChart(new App()).toJson());
  const kinds = manifests.map((manifest) => manifest.kind);
  expect(kinds).toEqual(
    expect.arrayContaining([
      "Namespace",
      "Deployment",
      "OnePasswordItem",
      "NetworkPolicy",
      "Service",
      "ServiceAccount",
      "Role",
      "RoleBinding",
      "Ingress",
      "PersistentVolumeClaim",
    ]),
  );

  const authItem = manifests.find(
    (manifest) => manifest.kind === "OnePasswordItem",
  );
  expect(authItem).toMatchObject({
    metadata: { name: "flags-auth" },
  });

  const deployment = manifests.find(
    (manifest) => manifest.kind === "Deployment",
  );
  expect(deployment).toMatchObject({
    spec: {
      strategy: { type: "Recreate" },
      template: {
        spec: {
          automountServiceAccountToken: false,
          serviceAccountName: "flags-ingress-observer",
          securityContext: { fsGroup: 1000 },
          volumes: expect.arrayContaining([
            {
              name: "ingress-observer",
              projected: {
                defaultMode: 0o440,
                sources: [
                  {
                    serviceAccountToken: {
                      path: "token",
                      expirationSeconds: 600,
                    },
                  },
                  {
                    configMap: {
                      name: "kube-root-ca.crt",
                      items: [{ key: "ca.crt", path: "ca.crt" }],
                    },
                  },
                ],
              },
            },
          ]),
          containers: [
            {
              name: "flags",
              ports: [
                { name: "http", containerPort: 7360 },
                { name: "eval", containerPort: 7361 },
              ],
              volumeMounts: expect.arrayContaining([
                {
                  name: "ingress-observer",
                  mountPath: FLAGS_TAILSCALE_INGRESS.directory,
                  readOnly: true,
                },
              ]),
              env: expect.arrayContaining([
                { name: "PORT", value: "7360" },
                { name: "FLAGS_EVALUATION_PORT", value: "7361" },
                {
                  name: "FLAGS_PUBLIC_ORIGIN",
                  value: "https://flags.tailnet-1a49.ts.net",
                },
                {
                  name: "FLAGS_OPERATOR_LOGINS",
                  value: "shepherdjerred@gmail.com",
                },
                {
                  name: "FLAGS_INGRESS_IDENTITY_DIR",
                  value: FLAGS_TAILSCALE_INGRESS.directory,
                },
                {
                  name: "FLAGS_MACHINE_TOKEN",
                  valueFrom: {
                    secretKeyRef: {
                      name: "flags-auth",
                      key: "FLAGS_MACHINE_TOKEN",
                    },
                  },
                },
              ]),
            },
          ],
        },
      },
    },
  });
  expect(JSON.stringify(deployment)).not.toContain("FLAGS_TRUSTED_PROXIES");

  const service = manifests.find((manifest) => manifest.kind === "Service");
  expect(service).toMatchObject({
    metadata: { name: "flags" },
    spec: {
      ports: [
        { name: "http", port: 7360 },
        { name: "eval", port: 7361 },
      ],
    },
  });

  const ingress = manifests.find((manifest) => manifest.kind === "Ingress");
  expect(ingress).toMatchObject({
    metadata: {
      name: FLAGS_TAILSCALE_INGRESS.name,
      namespace: FLAGS_TAILSCALE_INGRESS.namespace,
    },
    spec: {
      defaultBackend: {
        service: { name: "flags", port: { number: 7360 } },
      },
    },
  });
});

test("an activated service scopes network policy ingress and egress", () => {
  const manifests = z
    .array(Manifest)
    .parse(createFlagsChart(new App()).toJson());
  const netpol = manifests.find(
    (manifest) =>
      manifest.kind === "NetworkPolicy" &&
      manifest.metadata.name === "flags-app-netpol",
  );
  expect(netpol).toMatchObject({
    spec: {
      egress: [
        {
          ports: [
            { port: 53, protocol: "UDP" },
            { port: 53, protocol: "TCP" },
          ],
        },
        {
          to: [{ ipBlock: { cidr: KUBERNETES_API_ENDPOINT.cidr } }],
          ports: [{ port: KUBERNETES_API_ENDPOINT.port, protocol: "TCP" }],
        },
      ],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [{ port: 7360, protocol: "TCP" }],
        },
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
              },
              podSelector: {
                matchLabels: FLAGS_TAILSCALE_INGRESS.parentLabels,
              },
            },
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "temporal" },
              },
              podSelector: { matchLabels: { component: "repo-worker" } },
            },
          ],
          ports: [{ port: 7360, protocol: "TCP" }],
        },
        {
          ports: [{ port: 7361, protocol: "TCP" }],
          from: [
            "arcade",
            "delivery",
            "starlight-karma-bot-beta",
            "starlight-karma-bot-prod",
            "scout-beta",
            "scout-prod",
            "birmel",
            "temporal",
            "trmnl-dashboard",
            "alert-dashboard",
            "media",
            "storm-brain",
            "storm-forum",
            "storm-forum-beta",
            "storm-stats",
            "minecraft-tsmc",
            "woodpecker-ci",
            "woodpecker",
            "tracker",
            "golink",
            "mail",
            "feeds",
            "errors",
            "artifacts",
          ].map((namespace) => ({
            namespaceSelector: {
              matchLabels: { "kubernetes.io/metadata.name": namespace },
            },
          })),
        },
      ],
    },
  });
});
