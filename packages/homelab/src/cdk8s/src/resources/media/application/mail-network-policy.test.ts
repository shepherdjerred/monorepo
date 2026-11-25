import { beforeEach, expect, test } from "vitest";
import { App, Chart, Size } from "cdk8s";
import { PersistentVolumeClaim, Secret } from "cdk8s-plus-31";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createUnifiedMediaApplication } from "./index.ts";
import { createMailChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/mail.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

const ManifestDocSchema = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({ name: z.string() }),
  spec: z.record(z.string(), z.unknown()).optional(),
});

const NetpolPeerSchema = z.object({
  namespaceSelector: z
    .object({ matchLabels: z.record(z.string(), z.string()).optional() })
    .optional(),
  podSelector: z
    .object({ matchLabels: z.record(z.string(), z.string()).optional() })
    .optional(),
  ipBlock: z.object({ cidr: z.string() }).optional(),
});

const NetpolRuleSchema = z.object({
  from: z.array(NetpolPeerSchema).optional(),
  to: z.array(NetpolPeerSchema).optional(),
  ports: z.array(
    z.object({ port: z.union([z.number(), z.string()]), protocol: z.string() }),
  ),
});

const NetpolSpecSchema = z.object({
  podSelector: z.object({
    matchLabels: z.record(z.string(), z.string()).optional(),
  }),
  policyTypes: z.array(z.string()),
  ingress: z.array(NetpolRuleSchema).optional(),
  egress: z.array(NetpolRuleSchema).optional(),
});

type NetpolRule = z.infer<typeof NetpolRuleSchema>;
type ManifestDoc = z.infer<typeof ManifestDocSchema>;

beforeEach(resetProbeRegistry);

function synthesizeMediaAndMail(): ManifestDoc[] {
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
  createMailChart(app, true);
  return parseAllDocuments(app.synthYaml()).map((document) =>
    ManifestDocSchema.parse(document.toJSON()),
  );
}

function findBySuffix(docs: ManifestDoc[], kind: string, suffix: string) {
  const match = docs.find(
    (doc) => doc.kind === kind && doc.metadata.name.endsWith(suffix),
  );
  if (match === undefined) {
    throw new Error(`Missing rendered ${kind} ending with ${suffix}`);
  }
  return match;
}

function podLabelsOf(docs: ManifestDoc[], deploymentSuffix: string) {
  return z
    .object({
      template: z.object({
        metadata: z.object({ labels: z.record(z.string(), z.string()) }),
      }),
    })
    .parse(findBySuffix(docs, "Deployment", deploymentSuffix).spec).template
    .metadata.labels;
}

/** Cross-namespace access needs namespace and pod selectors on the SAME peer. */
function admitsTraffic(
  rules: NetpolRule[] | undefined,
  direction: "from" | "to",
  endpoint: { namespace: string; podLabels: Record<string, string> },
  tcpPort: number,
): boolean {
  return (rules ?? []).some(
    (rule) =>
      rule.ports.some(
        (portDef) => portDef.port === tcpPort && portDef.protocol === "TCP",
      ) &&
      (rule[direction] ?? []).some(
        (peer) =>
          peer.namespaceSelector?.matchLabels?.[
            "kubernetes.io/metadata.name"
          ] === endpoint.namespace &&
          Object.entries(peer.podSelector?.matchLabels ?? {}).every(
            ([labelKey, labelValue]) =>
              endpoint.podLabels[labelKey] === labelValue,
          ),
      ),
  );
}

test("the actual Media Network worker can submit HTTP API mail on :7371 without admitting other Media roles", () => {
  const docs = synthesizeMediaAndMail();
  const mediaNetworkLabels = podLabelsOf(docs, "media-network");
  const mailLabels = podLabelsOf(docs, "mail");
  const mediaNetpol = NetpolSpecSchema.parse(
    findBySuffix(docs, "NetworkPolicy", "media-network-netpol").spec,
  );
  const mailNetpol = NetpolSpecSchema.parse(
    findBySuffix(docs, "NetworkPolicy", "mail-app-netpol").spec,
  );

  expect(mediaNetpol.policyTypes).toContain("Egress");
  expect(mailNetpol.policyTypes).toContain("Ingress");
  expect(mediaNetworkLabels).toMatchObject(
    mediaNetpol.podSelector.matchLabels ?? {},
  );
  expect(mailLabels).toMatchObject(mailNetpol.podSelector.matchLabels ?? {});

  expect(
    admitsTraffic(
      mediaNetpol.egress,
      "to",
      { namespace: "mail", podLabels: mailLabels },
      7371,
    ),
  ).toBe(true);
  expect(
    admitsTraffic(
      mailNetpol.ingress,
      "from",
      { namespace: "media", podLabels: mediaNetworkLabels },
      7371,
    ),
  ).toBe(true);

  for (const forbiddenRole of ["media-api", "media-files"]) {
    expect(
      admitsTraffic(
        mailNetpol.ingress,
        "from",
        { namespace: "media", podLabels: podLabelsOf(docs, forbiddenRole) },
        7371,
      ),
    ).toBe(false);
  }
  expect(
    admitsTraffic(
      mailNetpol.ingress,
      "from",
      { namespace: "temporal", podLabels: mediaNetworkLabels },
      7371,
    ),
  ).toBe(false);
  for (const closedPort of [7370, 5000, 587]) {
    expect(
      admitsTraffic(
        mailNetpol.ingress,
        "from",
        { namespace: "media", podLabels: mediaNetworkLabels },
        closedPort,
      ),
    ).toBe(false);
  }
  expect(
    admitsTraffic(
      mailNetpol.ingress,
      "from",
      { namespace: "alert-dashboard", podLabels: {} },
      7371,
    ),
  ).toBe(true);
});
