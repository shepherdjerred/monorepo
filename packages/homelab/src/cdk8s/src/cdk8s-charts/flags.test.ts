import { beforeEach, expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { createFlagsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/flags.ts";
import { FLIPT_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

const Manifest = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({ name: z.string() }),
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
          securityContext: { fsGroup: 1000 },
          containers: [
            {
              name: "flags",
              ports: [
                { name: "http", containerPort: 7360 },
                { name: "eval", containerPort: 7361 },
              ],
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
                { name: "FLAGS_TRUSTED_PROXIES", value: "10.244.0.0/16" },
                { name: "FLAGS_FLIPT_URL", value: FLIPT_URL },
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
    spec: {
      defaultBackend: {
        service: { name: "flags", port: { number: 7360 } },
      },
    },
  });
});
