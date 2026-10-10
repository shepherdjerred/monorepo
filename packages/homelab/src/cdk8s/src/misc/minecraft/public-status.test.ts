import { App, Chart, Testing } from "cdk8s";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMinecraftPublicStatus } from "./public-status.ts";
import { createMinecraftProxyTrust } from "./proxy-trust.ts";
import { createForumNetwork } from "@shepherdjerred/homelab/cdk8s/src/resources/storm-forum/network.ts";

const Resource = z
  .object({ kind: z.string(), metadata: z.object({ name: z.string() }) })
  .loose();
const Ports = z.array(z.object({ port: z.number(), protocol: z.string() }));
const Peer = z.object({
  namespaceSelector: z
    .object({ matchLabels: z.record(z.string(), z.string()).optional() })
    .optional(),
  podSelector: z
    .object({ matchLabels: z.record(z.string(), z.string()) })
    .optional(),
});
const Egress = z.object({
  spec: z.object({
    podSelector: z.object({ matchLabels: z.record(z.string(), z.string()) }),
    egress: z.array(
      z.object({ to: z.array(Peer).optional(), ports: Ports.optional() }),
    ),
  }),
});

describe("private Minecraft status boundary", () => {
  it("exposes Query privately to forum pods and leaves gameplay router-only", () => {
    const chart = Testing.chart();
    createMinecraftPublicStatus(chart);
    createMinecraftProxyTrust(chart, "minecraft-tsmc", 25_565);
    const manifests = z.array(Resource).parse(Testing.synth(chart));
    expect(manifests.find((item) => item.kind === "Service")).toMatchObject({
      spec: {
        type: "ClusterIP",
        ports: [
          { name: "query", port: 25_565, protocol: "UDP" },
          { name: "bedrock", port: 19_132, protocol: "UDP" },
        ],
      },
    });
    const query = manifests.find(
      (item) => item.metadata.name === "minecraft-tsmc-query",
    );
    expect(query).toMatchObject({
      spec: {
        ingress: [
          {
            ports: [{ port: 25_565, protocol: "UDP" }],
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
                  matchLabels: {
                    "kubernetes.io/metadata.name": "storm-forum-beta",
                  },
                },
                podSelector: {
                  matchLabels: { app: "storm-forum", component: "web" },
                },
              },
            ],
          },
        ],
      },
    });
    const trust = manifests.find(
      (item) => item.metadata.name === "minecraft-tsmc-proxy-trust",
    );
    const trustSpec = z
      .object({ spec: z.object({ ingress: z.array(z.unknown()) }) })
      .parse(trust);
    expect(trustSpec.spec.ingress[0]).toEqual({
      from: [
        {
          namespaceSelector: {
            matchLabels: { "kubernetes.io/metadata.name": "mc-router" },
          },
          podSelector: {
            matchLabels: { "app.kubernetes.io/name": "mc-router" },
          },
        },
      ],
      ports: [{ protocol: "TCP", port: 25_565 }],
    });
  });
  it.each(["beta", "prod"] as const)(
    "allows %s status egress only on backend UDP",
    (stage) => {
      const chart = new Chart(new App(), "test", {
        namespace: stage === "prod" ? "storm-forum" : "storm-forum-beta",
      });
      createForumNetwork(chart, stage);
      const policy = z
        .array(Resource)
        .parse(Testing.synth(chart))
        .filter((item) => item.kind === "NetworkPolicy")
        .map((item) => Egress.parse(item))
        .find(
          (item) => item.spec.podSelector.matchLabels["component"] === "web",
        );
      const rule = policy?.spec.egress.find(
        (item) =>
          item.to?.[0]?.namespaceSelector?.matchLabels?.[
            "kubernetes.io/metadata.name"
          ] === "minecraft-tsmc",
      );
      expect(rule?.ports).toEqual([
        { port: 25_565, protocol: "UDP" },
        { port: 19_132, protocol: "UDP" },
      ]);
      expect(
        rule?.to?.[0]?.podSelector?.matchLabels["app.kubernetes.io/instance"],
      ).toBe("minecraft-tsmc");
    },
  );
});
