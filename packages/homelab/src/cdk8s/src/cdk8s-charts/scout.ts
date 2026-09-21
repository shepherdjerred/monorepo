import { Chart } from "cdk8s";
import type { App } from "cdk8s";
import { createScoutDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/index.ts";
import { createScoutPostgreSQLDatabase } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/scout-db.ts";
import { Namespace } from "cdk8s-plus-31";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { FLIPT_PORT } from "@shepherdjerred/homelab/cdk8s/src/resources/flipt/index.ts";
import { createScoutWorkflowWorker } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/workflow-worker.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { SCOUT_GATEWAY_APP_LABEL } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/gateway.ts";
import {
  gatewayTopologyRunsRole,
  SCOUT_GATEWAY_TOPOLOGY,
  type ScoutGatewayTopology,
} from "@shepherdjerred/homelab/cdk8s/src/resources/scout/topology.ts";

export type Stage = "prod" | "beta";

/**
 * Egress every Scout runtime role needs, whichever pod it runs in.
 *
 * Shared rather than cloned per role because the roles' needs turned out to be
 * the same set, not a subset: the gateway role answers `/scout ask` in process,
 * so it reaches Postgres, Temporal, Flipt, the OTLP gateway, SeaweedFS (LLM
 * archive) and external HTTPS exactly like the application role does. Cloning
 * the list would be duplicate text that drifts, not a tighter policy.
 *
 * The two places the roles genuinely differ stay per-role: ingress (the gateway
 * serves `httpSurface: "admin"`, so only Prometheus needs it) and Discord voice
 * RTP (see {@link discordVoiceRtpEgressRule}).
 */
function scoutRuntimeEgressRules() {
  return [
    dnsEgressRule(),
    // OTLP trace gateway (alloy-gateway.alloy-gateway.svc.cluster.local:4318)
    {
      to: [
        {
          namespaceSelector: {
            matchLabels: { "kubernetes.io/metadata.name": "alloy-gateway" },
          },
        },
      ],
      ports: [{ port: IntOrString.fromNumber(4318), protocol: "TCP" }],
    },
    // SeaweedFS S3 (seaweedfs-s3.seaweedfs.svc.cluster.local:8333)
    {
      to: [
        {
          namespaceSelector: {
            matchLabels: { "kubernetes.io/metadata.name": "seaweedfs" },
          },
        },
      ],
      ports: [{ port: IntOrString.fromNumber(8333), protocol: "TCP" }],
    },
    // Flipt evaluation (flipt-flipt-service.flipt.svc.cluster.local:8080)
    {
      to: [
        {
          namespaceSelector: {
            matchLabels: { "kubernetes.io/metadata.name": "flipt" },
          },
        },
      ],
      ports: [{ port: IntOrString.fromNumber(FLIPT_PORT), protocol: "TCP" }],
    },
    // In-namespace PostgreSQL (scout-<stage>-postgresql:5432)
    {
      to: [{ podSelector: {} }],
      ports: [{ port: IntOrString.fromNumber(5432), protocol: "TCP" }],
    },
    // Temporal gRPC for the stage-local competition dispatcher and the
    // embedded Scout workers. Restrict both to the server pod and port.
    {
      to: [
        {
          namespaceSelector: {
            matchLabels: { "kubernetes.io/metadata.name": "temporal" },
          },
          podSelector: { matchLabels: { app: "temporal-server" } },
        },
      ],
      ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
    },
    // External HTTPS (Riot API, Discord, Sentry, OpenAI, Gemini, ElevenLabs)
    externalHttpsEgressRule(),
  ];
}

/**
 * Discord voice RTP for the Hey Scout assistant, beta only — prod never sets
 * VOICE_ASSISTANT_ENABLED, so it gets no UDP egress at all. The gateway and
 * voice websockets ride the TCP/443 rule above, but the actual media stream is
 * UDP to a per-session Discord voice server; without this, `/scout join`
 * connects and then silently carries no audio in either direction, which reads
 * as a broken wake word rather than a blocked packet. Discord allocates those
 * endpoints from the ephemeral range, so the destination IP cannot be
 * enumerated ahead of time — the port range is the tightest constraint
 * available, and is narrower than the all-UDP rule Eufy P2P needs (see
 * home.ts).
 *
 * This rule follows the shard. Voice is a gateway-role capability, so on a
 * split stage it belongs to the scout-gateway policy and the application pod
 * does not get UDP egress at all; on an unsplit stage the combined pod keeps
 * it.
 */
function discordVoiceRtpEgressRule() {
  return {
    to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
    ports: [
      {
        port: IntOrString.fromNumber(50_000),
        endPort: 65_535,
        protocol: "UDP",
      },
    ],
  };
}
type WorkflowWorkerImageOverrides = {
  stable?: string;
  candidate?: string;
};

export function createScoutChart(
  app: App,
  stage: Stage,
  workflowWorkerImageOverrides?: WorkflowWorkerImageOverrides,
  /**
   * Render this stage as though its SCOUT_GATEWAY_TOPOLOGY entry said this.
   *
   * Same shape and purpose as `workflowWorkerImageOverrides` above: a
   * render-time override so a topology can be exercised through the real chart
   * without editing the standing decision. It is what lets the retirement path
   * — the rollback this whole state exists for — be proven by rendering it
   * rather than by mocking the module that decides it.
   */
  gatewayTopologyOverride?: ScoutGatewayTopology,
) {
  const chart = new Chart(app, `scout-${stage}`, {
    namespace: `scout-${stage}`,
    disableResourceNameHashes: true,
  });

  new Namespace(chart, `scout-${stage}-namespace`, {
    metadata: {
      name: `scout-${stage}`,
    },
  });

  const gatewayTopology =
    gatewayTopologyOverride ?? SCOUT_GATEWAY_TOPOLOGY[stage];
  // Voice belongs to whichever pod holds the shard, so this tracks `split`
  // specifically: a retiring stage has the shard back on the combined pod and
  // must get its UDP egress back with it.
  const splitTopology = gatewayTopologyRunsRole(gatewayTopology);

  createScoutPostgreSQLDatabase(chart, stage);
  createScoutDeployment(chart, stage, gatewayTopology);
  const stableImage =
    workflowWorkerImageOverrides?.stable ??
    versions[`shepherdjerred/scout-for-lol/${stage}/workflows/stable`];
  const candidateImage =
    workflowWorkerImageOverrides?.candidate ??
    versions[`shepherdjerred/scout-for-lol/${stage}/workflows/candidate`];
  const stableWorkflowWorker = createScoutWorkflowWorker(
    chart,
    stage,
    "stable",
    stableImage,
  );
  // The embedded backend poller is unversioned and cannot be a rollback target.
  // Bootstrap a capable stable version first. Keep the candidate Deployment
  // rendered even when its pin equals stable so promotion does not leave
  // unmanaged candidate resources behind when pruning is disabled.
  const candidateWorkflowWorker =
    stableWorkflowWorker === undefined
      ? undefined
      : createScoutWorkflowWorker(chart, stage, "candidate", candidateImage);
  const workflowWorkerCreated =
    stableWorkflowWorker !== undefined || candidateWorkflowWorker !== undefined;

  // NetworkPolicy: Allow ingress from Prometheus (scrapes scout-backend
  // metrics on :3000), in-namespace pods, and the shared s3-static-sites
  // Caddy (reverse-proxies /trpc + /api on scout-for-lol.com to
  // scout-service-{stage}:3000 cross-namespace). The Cloudflare Tunnel
  // now terminates at s3-static-sites, not directly at scout-{stage}.
  new KubeNetworkPolicy(chart, "scout-ingress-netpol", {
    metadata: { name: "scout-ingress-netpol" },
    spec: {
      // Backend pods only: the Patroni/Spilo postgres pods stay unselected
      // so this policy does not sever their Kubernetes API access.
      podSelector: { matchLabels: { app: "scout-backend" } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
            { podSelector: {} },
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "s3-static-sites",
                },
              },
            },
            ...(stage === "beta"
              ? [
                  {
                    namespaceSelector: {
                      matchLabels: {
                        "kubernetes.io/metadata.name": "temporal",
                      },
                    },
                    podSelector: {
                      matchLabels: { component: "scout-worker" },
                    },
                  },
                ]
              : []),
          ],
          ports: [{ port: IntOrString.fromNumber(3000), protocol: "TCP" }],
        },
      ],
    },
  });

  // NetworkPolicy: Allow egress to DNS, the OTLP trace gateway, Flipt, SeaweedFS S3, PostgreSQL, and external HTTPS
  new KubeNetworkPolicy(chart, "scout-egress-netpol", {
    metadata: { name: "scout-egress-netpol" },
    spec: {
      // Keep the operator-managed PostgreSQL pods outside this policy.
      podSelector: { matchLabels: { app: "scout-backend" } },
      policyTypes: ["Egress"],
      egress: [
        ...scoutRuntimeEgressRules(),
        // Voice follows the shard: only an UNSPLIT beta keeps it here, because
        // on a split stage `/scout join` runs in scout-gateway.
        ...(stage === "beta" && !splitTopology
          ? [discordVoiceRtpEgressRule()]
          : []),
      ],
    },
  });

  // The gateway runtime role runs in its own pod on a split stage, so it needs
  // its own pair of policies: a NetworkPolicy only governs pods its selector
  // matches, and the two above deliberately select `app: scout-backend` alone
  // to keep the operator-managed Patroni/Spilo pods unselected.
  //
  // Kept rendered through retirement, unlike the voice rule above. This
  // Application does not prune, so a policy that stopped being rendered would
  // stop being managed and linger; keeping it means the stage stays fully
  // managed and the policy simply selects no pods once the Deployment is at
  // zero replicas. It is deleted with the Deployment when the stage goes
  // `absent`.
  if (gatewayTopology !== "absent") {
    new KubeNetworkPolicy(chart, "scout-gateway-netpol", {
      metadata: { name: "scout-gateway-netpol" },
      spec: {
        podSelector: { matchLabels: { app: SCOUT_GATEWAY_APP_LABEL } },
        policyTypes: ["Ingress", "Egress"],
        // Tighter than the application role's ingress on purpose. This role
        // serves `httpSurface: "admin"` — probes and /metrics — so Prometheus
        // is the only thing that needs to reach it. It is not behind the
        // s3-static-sites reverse proxy and serves no tRPC/OAuth/SSE surface.
        ingress: [
          {
            from: [
              {
                namespaceSelector: {
                  matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
                },
              },
            ],
            ports: [{ port: IntOrString.fromNumber(3000), protocol: "TCP" }],
          },
        ],
        egress: [
          ...scoutRuntimeEgressRules(),
          // This is the pod that runs `/scout join`, so the voice media stream
          // egresses from here.
          ...(stage === "beta" ? [discordVoiceRtpEgressRule()] : []),
        ],
      },
    });
  }

  if (workflowWorkerCreated) {
    new KubeNetworkPolicy(chart, "scout-workflow-worker-netpol", {
      metadata: {
        name: "scout-workflow-worker-netpol",
        annotations: { "argocd.argoproj.io/sync-wave": "-2" },
      },
      spec: {
        podSelector: {
          matchLabels: { "worker-family": `scout-${stage}-workflows` },
        },
        policyTypes: ["Ingress", "Egress"],
        ingress: [
          {
            from: [
              {
                namespaceSelector: {
                  matchLabels: {
                    "kubernetes.io/metadata.name": "prometheus",
                  },
                },
              },
            ],
            ports: [{ port: IntOrString.fromNumber(9464), protocol: "TCP" }],
          },
        ],
        egress: [
          dnsEgressRule(),
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: {
                    "kubernetes.io/metadata.name": "temporal",
                  },
                },
                podSelector: { matchLabels: { app: "temporal-server" } },
              },
            ],
            ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
          },
        ],
      },
    });
  }
}
