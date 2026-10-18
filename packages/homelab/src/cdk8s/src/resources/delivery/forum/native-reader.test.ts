import { App } from "cdk8s";
import { expect, test } from "vitest";
import { z } from "zod";
import { createDeliveryChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";
import { forumNativeObservation } from "@shepherdjerred/ops-model/forum/native-observation.ts";

function nativeForumResources() {
  resetProbeRegistry();
  const chart = createDeliveryChart(new App(), {
    image: `docker.io/shepherdjerred/delivery@sha256:${"a".repeat(64)}`,
    serviceItemId: "test-service",
    tailscaleItemId: "test-tailnet",
    forumReaderItemId: "test-restricted-reader",
    forumObserverItemId: "test-runtime-observer",
  });
  return z
    .array(
      z
        .object({
          kind: z.string(),
          metadata: z.object({
            name: z.string(),
            namespace: z.string().optional(),
          }),
          spec: z.unknown().optional(),
        })
        .loose(),
    )
    .parse(chart.toJson());
}
test("only the API gets a projected observer token and the observer has no Secret reads or workload writes", () => {
  const resources = nativeForumResources();
  const role = resources.find(
    (item) =>
      item.kind === "Role" && item.metadata.name === "delivery-forum-observer",
  );
  expect(role?.["rules"]).toEqual([
    { apiGroups: [""], resources: ["pods"], verbs: ["get"] },
    { apiGroups: [""], resources: ["pods/exec"], verbs: ["get", "create"] },
    {
      apiGroups: [""],
      resources: ["persistentvolumeclaims"],
      resourceNames: forumNativeObservation.claims,
      verbs: ["get"],
    },
  ]);
  const deployment = z
    .object({
      spec: z.object({
        template: z.object({
          spec: z.object({
            automountServiceAccountToken: z.boolean(),
            serviceAccountName: z.string(),
            containers: z.array(
              z.object({
                name: z.string(),
                volumeMounts: z
                  .array(
                    z.object({
                      name: z.string(),
                      readOnly: z.boolean().optional(),
                    }),
                  )
                  .optional(),
              }),
            ),
            initContainers: z.array(
              z.object({
                volumeMounts: z
                  .array(z.object({ name: z.string() }))
                  .optional(),
              }),
            ),
            volumes: z.array(
              z.object({ name: z.string(), projected: z.unknown().optional() }),
            ),
          }),
        }),
      }),
    })
    .parse(resources.find((item) => item.kind === "Deployment"));
  const pod = deployment.spec.template.spec;
  expect(pod.automountServiceAccountToken).toBe(false);
  expect(pod.serviceAccountName).toBe("delivery-forum-observer");
  expect(
    pod.containers
      .filter((container) =>
        container.volumeMounts?.some(
          (mount) => mount.name === "forum-observer" && mount.readOnly,
        ),
      )
      .map((container) => container.name),
  ).toEqual(["delivery"]);
  expect(
    pod.initContainers.some((container) =>
      container.volumeMounts?.some((mount) => mount.name === "forum-observer"),
    ),
  ).toBe(false);
  expect(
    pod.volumes.find((volume) => volume.name === "forum-observer")?.projected,
  ).toMatchObject({
    defaultMode: 0o440,
    sources: expect.arrayContaining([
      { serviceAccountToken: { path: "token", expirationSeconds: 600 } },
    ]),
  });
  expect(
    resources.find((item) => item.kind === "ServiceAccount")?.[
      "automountServiceAccountToken"
    ],
  ).toBe(false);
  const policy = resources.find(
    (item) => item.kind === "ValidatingAdmissionPolicy",
  );
  expect(JSON.stringify(policy?.spec)).toContain("CONNECT");
  expect(JSON.stringify(policy?.spec)).toContain("object.command");
});
