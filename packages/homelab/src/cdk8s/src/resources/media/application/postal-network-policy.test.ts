import { beforeEach, expect, test } from "vitest";
import { App, Chart, Size } from "cdk8s";
import { PersistentVolumeClaim, Secret } from "cdk8s-plus-31";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createUnifiedMediaApplication } from "./index.ts";
import { createPostalChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/postal.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

const Selector = z.object({
  matchLabels: z.record(z.string(), z.string()).optional(),
});
const Peer = z.object({
  namespaceSelector: Selector.optional(),
  podSelector: Selector.optional(),
});
const Rule = z.object({
  from: z.array(Peer).optional(),
  to: z.array(Peer).optional(),
  ports: z.array(z.object({ port: z.number(), protocol: z.string() })),
});
const Policy = z.object({
  podSelector: Selector,
  policyTypes: z.array(z.string()),
  ingress: z.array(Rule).optional(),
  egress: z.array(Rule).optional(),
});
const Resource = z.object({
  kind: z.string(),
  metadata: z.object({ name: z.string() }),
  spec: z.unknown().optional(),
});
type Resource = z.infer<typeof Resource>;
type Rule = z.infer<typeof Rule>;

beforeEach(resetProbeRegistry);

function renderBothCharts() {
  const app = new App();
  const media = new Chart(app, "media", {
    namespace: "media",
    disableResourceNameHashes: true,
  });
  createUnifiedMediaApplication(media, {
    image: `docker.io/shepherdjerred/media@sha256:${"1".repeat(64)}`,
    claims: {
      movies: new PersistentVolumeClaim(media, "movies", {
        storage: Size.gibibytes(1),
      }),
      tv: new PersistentVolumeClaim(media, "tv", {
        storage: Size.gibibytes(1),
      }),
      downloads: new PersistentVolumeClaim(media, "downloads", {
        storage: Size.gibibytes(1),
      }),
    },
    plex: {
      serviceName: "plex",
      tokenSecret: Secret.fromSecretName(media, "plex-token", "plex-secret"),
    },
  });
  createPostalChart(app);
  return parseAllDocuments(app.synthYaml()).map((document) =>
    Resource.parse(document.toJSON()),
  );
}

function resource(resources: Resource[], kind: string, suffix: string) {
  const result = resources.find(
    (item) => item.kind === kind && item.metadata.name.endsWith(suffix),
  );
  if (result === undefined)
    throw new Error(`Missing rendered ${kind} ${suffix}`);
  return result;
}

function labels(resources: Resource[], deployment: string) {
  return z
    .object({
      template: z.object({
        metadata: z.object({ labels: z.record(z.string(), z.string()) }),
      }),
    })
    .parse(resource(resources, "Deployment", deployment).spec).template.metadata
    .labels;
}

/** Cross-namespace access needs the namespace and pod selectors on the SAME
 * peer. Different entries in from/to are alternatives, not a conjunction. */
function permits(
  rules: Rule[] | undefined,
  direction: "from" | "to",
  identity: { namespace: string; pod: Record<string, string> },
  port: number,
) {
  return (rules ?? []).some(
    (rule) =>
      rule.ports.some(
        (value) => value.port === port && value.protocol === "TCP",
      ) &&
      (rule[direction] ?? []).some(
        (peer) =>
          peer.namespaceSelector?.matchLabels?.[
            "kubernetes.io/metadata.name"
          ] === identity.namespace &&
          Object.entries(peer.podSelector?.matchLabels ?? {}).every(
            ([key, value]) => identity.pod[key] === value,
          ),
      ),
  );
}

test("the actual Media Network worker can submit Postal API mail through both policies without admitting other roles", () => {
  const resources = renderBothCharts();
  const networkLabels = labels(resources, "media-network");
  const postalLabels = labels(resources, "postal-web");
  const network = Policy.parse(
    resource(resources, "NetworkPolicy", "media-network-netpol").spec,
  );
  const postal = Policy.parse(
    resource(resources, "NetworkPolicy", "postal-web-netpol").spec,
  );
  expect(network.policyTypes).toContain("Egress");
  expect(postal.policyTypes).toContain("Ingress");
  expect(networkLabels).toMatchObject(network.podSelector.matchLabels ?? {});
  expect(postalLabels).toMatchObject(postal.podSelector.matchLabels ?? {});
  expect(
    permits(
      network.egress,
      "to",
      { namespace: "postal", pod: postalLabels },
      5000,
    ),
  ).toBe(true);
  expect(
    permits(
      postal.ingress,
      "from",
      { namespace: "media", pod: networkLabels },
      5000,
    ),
  ).toBe(true);
  for (const role of ["media-api", "media-files"]) {
    expect(
      permits(
        postal.ingress,
        "from",
        { namespace: "media", pod: labels(resources, role) },
        5000,
      ),
    ).toBe(false);
  }
  expect(
    permits(
      postal.ingress,
      "from",
      { namespace: "temporal", pod: networkLabels },
      5000,
    ),
  ).toBe(false);
  for (const port of [25, 587, 5001]) {
    expect(
      permits(
        postal.ingress,
        "from",
        { namespace: "media", pod: networkLabels },
        port,
      ),
    ).toBe(false);
  }
  for (const namespace of ["tailscale", "prometheus", "alert-dashboard"]) {
    expect(permits(postal.ingress, "from", { namespace, pod: {} }, 5000)).toBe(
      true,
    );
  }
});
