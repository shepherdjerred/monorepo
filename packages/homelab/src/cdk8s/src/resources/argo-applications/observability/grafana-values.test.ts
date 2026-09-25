import { describe, expect, it } from "vitest";
import {
  CI_IO_OBSERVABILITY_VALUES,
  CI_KUBE_STATE_METRICS_VALUES,
} from "./grafana-values.ts";

describe("Woodpecker I/O observability Helm values", () => {
  it("keeps cAdvisor sampling at 10 seconds without accelerating all kube-state-metrics", () => {
    expect(
      CI_IO_OBSERVABILITY_VALUES.kubelet.serviceMonitor.cAdvisorInterval,
    ).toBe("10s");
    expect(CI_KUBE_STATE_METRICS_VALUES).not.toHaveProperty("prometheus");
  });

  it("allowlists the pod attribution and PVC backup-policy labels", () => {
    expect(CI_KUBE_STATE_METRICS_VALUES.metricLabelsAllowlist).toEqual([
      "pods=[ci.sjer.red/step-key,ci.sjer.red/commit]",
      "persistentvolumeclaims=[velero.io/backup]",
    ]);
  });

  // Woodpecker stamps no identifying pod metadata of its own, so every key
  // here is written by the configuration extension. This list is one of three
  // places that must agree; see the comment on the constant.
  it("allowlists only the pipeline metadata the extension stamps", () => {
    expect(CI_KUBE_STATE_METRICS_VALUES.metricAnnotationsAllowList).toEqual([
      "pods=[ci.sjer.red/branch,ci.sjer.red/pipeline-url]",
    ]);
  });

  it("never enables wildcard Kubernetes metadata export", () => {
    const values = JSON.stringify(CI_KUBE_STATE_METRICS_VALUES);
    expect(values).not.toContain("[*]");
    expect(values).not.toContain("=[*]");
  });
});
