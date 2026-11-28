import { Testing } from "cdk8s";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  COREPROTECT_ADDRESSES,
  createMinecraftTsmcEgress,
  MOJANG_TEXTURES_CIDR,
} from "./tsmc-egress.ts";

const Port = z.object({ port: z.number(), protocol: z.string() });
const Peer = z.object({
  ipBlock: z
    .object({ cidr: z.string(), except: z.array(z.string()).optional() })
    .optional(),
  namespaceSelector: z
    .object({ matchLabels: z.record(z.string(), z.string()).optional() })
    .optional(),
  podSelector: z
    .object({ matchLabels: z.record(z.string(), z.string()).optional() })
    .optional(),
});
const Rule = z.object({ to: z.array(Peer), ports: z.array(Port) });
const Policy = z.object({
  metadata: z.object({ name: z.string(), namespace: z.string() }),
  spec: z.object({
    podSelector: z.object({}).strict(),
    policyTypes: z.array(z.string()),
    egress: z.array(Rule),
  }),
});

function egressPolicy() {
  const chart = Testing.chart();
  createMinecraftTsmcEgress(chart);
  const [policy] = Testing.synth(chart);
  return Policy.parse(policy);
}

function rulesFor(port: number, protocol = "TCP") {
  return egressPolicy().spec.egress.filter((rule) =>
    rule.ports.some((p) => p.port === port && p.protocol === protocol),
  );
}

function peers(port: number) {
  return rulesFor(port).flatMap((rule) =>
    rule.to.map(
      (peer) =>
        peer.namespaceSelector?.matchLabels?.["kubernetes.io/metadata.name"],
    ),
  );
}

describe("minecraft-tsmc egress", () => {
  it("polices Egress for every pod in the namespace", () => {
    const policy = egressPolicy();
    expect(policy.metadata).toEqual({
      name: "minecraft-tsmc-egress",
      namespace: "minecraft-tsmc",
    });
    expect(policy.spec.policyTypes).toEqual(["Egress"]);
  });

  it("names a port on every rule", () => {
    for (const rule of egressPolicy().spec.egress) {
      expect(rule.ports.length).toBeGreaterThan(0);
    }
  });

  it("opens plain HTTP only to CoreProtect's and Mojang's texture addresses", () => {
    const http = rulesFor(80);
    expect(http).toHaveLength(1);
    expect(http[0]?.ports).toEqual([{ port: 80, protocol: "TCP" }]);
    expect(http[0]?.to).toEqual([
      ...COREPROTECT_ADDRESSES.map((cidr) => ({ ipBlock: { cidr } })),
      { ipBlock: { cidr: MOJANG_TEXTURES_CIDR } },
    ]);
  });

  it("keeps the private ranges closed on every public-address rule", () => {
    const broad = egressPolicy()
      .spec.egress.flatMap((rule) => rule.to)
      .filter((peer) => peer.ipBlock?.cidr === "0.0.0.0/0");
    expect(broad.length).toBeGreaterThan(0);
    for (const peer of broad) {
      expect(peer.ipBlock?.except).toEqual(
        expect.arrayContaining(["10.0.0.0/8", "192.168.0.0/16"]),
      );
    }
  });

  it("reaches the in-cluster services The Storm calls on their own ports", () => {
    expect(peers(7361)).toEqual(["flags"]);
    expect(peers(7422)).toEqual(["storm-stats"]);
    expect(peers(3000)).toEqual(["storm-brain"]);
  });

  it("allows Geyser's STUN discovery over UDP only", () => {
    expect(rulesFor(3478, "UDP")).toHaveLength(1);
    expect(rulesFor(19_302, "UDP")).toHaveLength(1);
    expect(rulesFor(3478)).toHaveLength(0);
  });
});
