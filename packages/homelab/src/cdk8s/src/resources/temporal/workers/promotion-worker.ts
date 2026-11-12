import { temporalAddressEnv } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/address.ts";
import type { Chart } from "cdk8s";
import {
  EnvValue,
  Secret,
  ServiceAccount,
  Service,
  Pods,
  type ISecret,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import {
  dnsEgressRule,
  prometheusIngressRule,
  nsPeer,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { temporalFeatureFlagEnvironment } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/feature-flags.ts";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import { codexApiKeyEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-provider-credentials.ts";
import { createTemporalAgentWorker } from "./agent-worker.ts";
import promotionPolicy from "homelab/src/talos/seccomp/promotion-policy.json" with { type: "json" };
import {
  telemetryEnv,
  seaweedfsS3,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

export function createTemporalPromotionWorker(
  chart: Chart,
  props: { serverServiceName: string; temporalSecret: ISecret },
) {
  const credentials = new OnePasswordItem(chart, "temporal-promotion-1p", {
    metadata: { name: "temporal-promotion-credentials" },
    spec: { itemPath: vaultItemPath("and7gl2qtwxrlc3ksasdlrrd74") },
  });
  const credentialSecret = Secret.fromSecretName(
    chart,
    "temporal-promotion-credential-secret",
    credentials.name,
  );
  const browser = new OnePasswordItem(chart, "temporal-promotion-pinchtab-1p", {
    metadata: { name: "temporal-promotion-pinchtab" },
    spec: { itemPath: vaultItemPath("t2dgtdx47yd2gegad6zeelzylu") },
  });
  const browserSecret = Secret.fromSecretName(
    chart,
    "temporal-promotion-browser-secret",
    browser.name,
  );
  const serviceAccount = new ServiceAccount(
    chart,
    "temporal-promotion-worker-sa",
    {
      metadata: { name: "temporal-promotion-worker" },
    },
  );
  const deployment = createTemporalAgentWorker(chart, {
    name: "temporal-promotion-worker",
    component: "promotion-worker",
    // Install and verify the node prerequisite before releasing this opt-in.
    sandboxSeccompProfile: `profiles/${promotionPolicy.profileName}`,
    initializeStickyTmpDirectory: true,
    serviceAccount,
    envVariables: {
      ...temporalFeatureFlagEnvironment(),
      ...llmArchiveEnvVars(),
      ...temporalAddressEnv(props.serverServiceName),
      TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("promotion"),
      PROMOTION_DISCORD_SOCKET: EnvValue.fromValue(
        "/tmp/storm-promotion-discord/daemon.sock",
      ),
      TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
      AGENT_PROVIDER_UID: EnvValue.fromValue("1001"),
      ENVIRONMENT: EnvValue.fromValue("production"),
      ...telemetryEnv({ serviceName: "temporal-promotion-worker" }),
      NODE_EXTRA_CA_CERTS: EnvValue.fromValue("/etc/kubernetes/ca.crt"),
      ...codexApiKeyEnvVars(props.temporalSecret),
      S3_ENDPOINT: EnvValue.fromValue(seaweedfsS3.endpoint),
      AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
        secret: props.temporalSecret,
        key: "AWS_ACCESS_KEY_ID",
      }),
      AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
        secret: props.temporalSecret,
        key: "AWS_SECRET_ACCESS_KEY",
      }),
      PINCHTAB_BASE_URL: EnvValue.fromValue(
        "http://pinchtab.pinchtab.svc.cluster.local:9867",
      ),
      PINCHTAB_TOKEN: EnvValue.fromSecretValue({
        secret: browserSecret,
        key: "PINCHTAB_TOKEN",
      }),
      ANTI_CAPTCHA_API_KEY: EnvValue.fromSecretValue({
        secret: credentialSecret,
        key: "ANTI_CAPTCHA_API_KEY",
      }),
      STORM_PROMOTION_LOGINS: EnvValue.fromSecretValue({
        secret: credentialSecret,
        key: "STORM_PROMOTION_LOGINS",
      }),
      OPS_INGEST_TOKEN: EnvValue.fromSecretValue({
        secret: props.temporalSecret,
        key: "OPS_INGEST_TOKEN",
      }),
    },
  });
  new KubeNetworkPolicy(chart, "temporal-promotion-worker-netpol", {
    metadata: { name: "temporal-promotion-worker-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "promotion-worker" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [nsPeer("alert-dashboard")],
          ports: [tcp(7343)],
        },
        prometheusIngressRule([9464, 9465]),
      ],
      egress: [
        dnsEgressRule(),
        {
          to: [{ podSelector: { matchLabels: { app: "temporal-server" } } }],
          ports: [tcp(7233)],
        },
        ...[
          { namespace: "pinchtab", port: 9867 },
          { namespace: "seaweedfs", port: 8333 },
          { namespace: "alloy-gateway", port: 4318 },
        ].map(({ namespace, port }) => ({
          to: [nsPeer(namespace)],
          ports: [tcp(port)],
        })),
        { ports: [tcp(443)] },
      ],
    },
  });
  new Service(chart, "promotion-status-service", {
    metadata: { name: "promotion-status" },
    selector: Pods.select(chart, "promotion-status-pods", {
      labels: { component: "promotion-worker" },
    }),
    ports: [{ port: 7343, name: "http" }],
  });
  return deployment;
}
