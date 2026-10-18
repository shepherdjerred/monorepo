import { App, Chart, Testing } from "cdk8s";
import { expect, test } from "vitest";
import { z } from "zod";
import { createForumNetwork } from "./network.ts";

const webNetwork = z.object({
  kind: z.literal("NetworkPolicy"),
  spec: z.object({
    podSelector: z.object({
      matchLabels: z.object({
        app: z.literal("storm-forum"),
        component: z.literal("web"),
      }),
    }),
    ingress: z.array(
      z.object({
        from: z.array(z.unknown()),
        ports: z.array(
          z.object({ port: z.number(), protocol: z.literal("TCP") }),
        ),
      }),
    ),
  }),
});

test.each(["beta", "prod"] as const)(
  "%s allows only the Delivery API to reach the authenticated observer port",
  (stage) => {
    const chart = new Chart(new App(), `forum-network-${stage}`, {
      namespace: stage === "prod" ? "storm-forum" : "storm-forum-beta",
    });
    createForumNetwork(chart, stage);
    const policy = webNetwork.parse(
      Testing.synth(chart).find(
        (resource) => webNetwork.safeParse(resource).success,
      ),
    );
    const observer = {
      from: [
        {
          namespaceSelector: {
            matchLabels: { "kubernetes.io/metadata.name": "delivery" },
          },
          podSelector: { matchLabels: { app: "delivery" } },
        },
      ],
      ports: [{ port: 8082, protocol: "TCP" }],
    };
    expect(
      policy.spec.ingress.filter((rule) =>
        rule.ports.some(({ port }) => port === 8082),
      ),
    ).toEqual([observer]);
    expect(
      policy.spec.ingress.filter((rule) =>
        JSON.stringify(rule.from).includes(
          '"kubernetes.io/metadata.name":"delivery"',
        ),
      ),
    ).toEqual([observer]);
  },
);
