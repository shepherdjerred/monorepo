import { expect, test } from "vitest";
import { z } from "zod";
import {
  synthesizeTemporalResources,
  findTemporalResource,
} from "@shepherdjerred/homelab/cdk8s/src/temporal-test-resources.ts";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";

test("infra kubectl uses mounted, rotating service-account credentials without embedded secrets", () => {
  const resources = synthesizeTemporalResources(".test-synth-infra-kubeconfig");
  const pod = z
    .object({
      template: z.object({
        spec: z.object({
          automountServiceAccountToken: z.boolean(),
          serviceAccountName: z.string(),
          containers: z.array(
            z.object({
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
          volumes: z.array(
            z.object({
              name: z.string(),
              configMap: z.object({ name: z.string() }).optional(),
            }),
          ),
        }),
      }),
    })
    .parse(
      findTemporalResource(
        resources,
        "Deployment",
        "temporal-temporal-infra-worker",
      ).spec,
    ).template.spec;
  expect(pod.automountServiceAccountToken).toBe(true);
  expect(pod.serviceAccountName).toBe("temporal-infra-worker");
  const container = pod.containers[0];
  expect(container?.env).toContainEqual({
    name: "KUBECONFIG",
    value: "/etc/kubernetes/infra-worker/config",
  });
  const mount = container?.volumeMounts.find(
    (entry) => entry.mountPath === "/etc/kubernetes/infra-worker",
  );
  expect(mount?.readOnly).toBe(true);
  const configName = pod.volumes.find((entry) => entry.name === mount?.name)
    ?.configMap?.name;
  if (configName === undefined)
    throw new Error("Missing infra kubeconfig volume");
  const config = z
    .object({
      apiVersion: z.literal("v1"),
      kind: z.literal("Config"),
      clusters: z.array(
        z.object({
          cluster: z.object({
            server: z.literal("https://kubernetes.default.svc"),
            "certificate-authority": z.literal(
              "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
            ),
          }),
        }),
      ),
      users: z.array(
        z.object({
          user: z.strictObject({
            tokenFile: z.literal(
              "/var/run/secrets/kubernetes.io/serviceaccount/token",
            ),
          }),
        }),
      ),
    })
    .parse(
      JSON.parse(
        findTemporalResource(resources, "ConfigMap", configName).data?.[
          "config"
        ] ?? "null",
      ),
    );
  expect(config.users).toHaveLength(1);
});
