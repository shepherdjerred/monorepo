import type { Chart } from "cdk8s";
import { EnvValue, Secret, ServiceAccount, type ISecret } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { dnsEgressRule } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { temporalFeatureFlagEnvironment } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/feature-flags.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";
import { llmArchiveEnvVars } from "@shepherdjerred/homelab/cdk8s/src/misc/llm-archive-env.ts";
import { createTemporalAgentWorker } from "./agent-worker.ts";

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
    serviceAccount,
    envVariables: {
      ...temporalFeatureFlagEnvironment(),
      ...llmArchiveEnvVars(),
      TEMPORAL_ADDRESS: EnvValue.fromValue(`${props.serverServiceName}:7233`),
      TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("promotion"),
      TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
      AGENT_PROVIDER_UID: EnvValue.fromValue("1001"),
      ENVIRONMENT: EnvValue.fromValue("production"),
      TELEMETRY_ENABLED: EnvValue.fromValue("true"),
      OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL),
      TELEMETRY_SERVICE_NAME: EnvValue.fromValue("temporal-promotion-worker"),
      NODE_EXTRA_CA_CERTS: EnvValue.fromValue("/etc/kubernetes/ca.crt"),
      OPENAI_API_KEY: EnvValue.fromSecretValue({
        secret: props.temporalSecret,
        key: "OPENAI_API_KEY",
      }),
      S3_ENDPOINT: EnvValue.fromValue(
        "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
      ),
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
    },
  });
  new KubeNetworkPolicy(chart, "temporal-promotion-worker-netpol", {
    metadata: { name: "temporal-promotion-worker-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "promotion-worker" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [9464, 9465].map((port) => ({
            port: IntOrString.fromNumber(port),
            protocol: "TCP",
          })),
        },
      ],
      egress: [
        dnsEgressRule(),
        {
          to: [{ podSelector: { matchLabels: { app: "temporal-server" } } }],
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
        },
        ...[
          { namespace: "pinchtab", port: 9867 },
          { namespace: "seaweedfs", port: 8333 },
          { namespace: "alloy-gateway", port: 4318 },
        ].map(({ namespace, port }) => ({
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": namespace },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(port), protocol: "TCP" }],
        })),
        { ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }] },
      ],
    },
  });
  return deployment;
}
