import { describe, expect, test } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import { createMinecraftProxyTrust } from "./proxy-trust.ts";

const NetworkPolicySchema = z.object({
  apiVersion: z.literal("networking.k8s.io/v1"),
  kind: z.literal("NetworkPolicy"),
  metadata: z.object({ name: z.string(), namespace: z.string() }),
});

describe("Minecraft proxy trust", () => {
  test("gives each root-managed policy a release-unique identity", () => {
    const app = new App();
    const chart = new Chart(app, "test", {
      disableResourceNameHashes: true,
    });
    const namespaces = [
      "minecraft-sjerred",
      "minecraft-shuxin",
      "minecraft-tsmc",
    ];
    for (const namespace of namespaces) {
      createMinecraftProxyTrust(chart, namespace, 25_565);
    }

    const policies = Testing.synth(chart).map((manifest) =>
      NetworkPolicySchema.parse(manifest),
    );

    expect(
      policies.map(({ metadata }) => [metadata.namespace, metadata.name]),
    ).toEqual(
      namespaces.map((namespace) => [namespace, `${namespace}-proxy-trust`]),
    );
    expect(
      new Set(
        policies.map(
          ({ apiVersion, kind, metadata }) =>
            `${apiVersion}/${kind}/${metadata.name}`,
        ),
      ).size,
    ).toBe(policies.length);
  });
});
