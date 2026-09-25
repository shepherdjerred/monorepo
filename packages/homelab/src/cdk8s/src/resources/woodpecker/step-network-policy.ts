import type { Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

/**
 * Label every generated CI step pod carries.
 *
 * Written by the configuration extension's emitter
 * (`packages/woodpecker-config-extension/src/pipeline/emit.ts`), which is the
 * only thing that generates a step pod spec — Woodpecker's own pod names
 * (`wp-<ulid>-<workflow>-step-<n>`) are not selectable and it stamps no labels
 * of its own. The value varies per step, so the policy selects on the key's
 * existence; that needs no change to the emitter and matches exactly the pods
 * it generates. macOS lanes run on the local backend and produce no pod, so
 * they are correctly outside this.
 *
 * The same key is duplicated in the monitoring rules for the same reason. Do
 * not rename it in one place.
 */
const CI_STEP_POD_LABEL = "ci.sjer.red/step-key";

/** buildkitd's own namespace and gRPC port, which the image lanes dial. */
const BUILDKITD_NAMESPACE = "buildkitd";
const BUILDKITD_PORT = 1234;

/**
 * The network boundary CI step pods are meant to sit inside.
 *
 * Step pods run branch code with production credentials mounted, and until now
 * nothing constrained where that code could connect. The Buildkite chart did
 * not constrain it either, so this closes a gap carried over rather than one
 * the migration introduced.
 *
 * Be honest about what it buys today: the cluster runs Flannel, which does not
 * enforce NetworkPolicy, so this is a declared boundary that takes effect if
 * the CNI is ever replaced — the same standing this repo's other policies have
 * (see the comments on the Temporal agent-worker and pinchtab policies, where
 * a pod-local firewall does the actual enforcement). Enforcing it for real
 * would mean injecting a firewall into every step container, and step pod
 * specs come from the configuration extension rather than from cdk8s, so that
 * is a separate and much larger change.
 *
 * One rule about reading labels, since `WOODPECKER_BACKEND_K8S_POD_LABELS_`
 * `ALLOW_FROM_STEP` is enabled: these labels arrive from generated YAML. That
 * is trustworthy only because the configuration extension is the sole
 * generator and committed pipeline YAML is ignored. A policy may therefore
 * *narrow* access based on such a label, as this one does, but must never
 * *grant* extra access based on one.
 */
export function createWoodpeckerStepNetworkPolicy(chart: Chart) {
  return new KubeNetworkPolicy(chart, "woodpecker-step-netpol", {
    metadata: { name: "woodpecker-step-netpol" },
    spec: {
      podSelector: {
        matchExpressions: [{ key: CI_STEP_POD_LABEL, operator: "Exists" }],
      },
      policyTypes: ["Egress", "Ingress"],
      // Nothing dials a step pod. The agent drives steps through the
      // Kubernetes API, not the pod network, and services declared beside a
      // step share its pod and talk over localhost.
      ingress: [],
      egress: [
        dnsEgressRule(),
        {
          // The image lanes drive builds through buildkitd's plaintext gRPC
          // endpoint. It is the one in-cluster destination steps need, and the
          // only reason this policy is not HTTPS-only; buildkitd's own policy
          // already restricts ingress to this namespace.
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": BUILDKITD_NAMESPACE,
                },
              },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(BUILDKITD_PORT), protocol: "TCP" },
          ],
        },
        // Everything else a step reaches is HTTPS: github.com and its API,
        // ghcr.io, registry.npmjs.org, the published sites, and SeaweedFS S3
        // — which is reached over the tailnet rather than by cluster DNS.
        // A CIDR allowlist is not an option: GitHub's and npm's ranges
        // change, and a rotted list would fail builds for a boundary that is
        // not enforced anyway.
        externalHttpsEgressRule(),
      ],
    },
  });
}
