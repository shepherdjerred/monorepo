import { describe, expect, it } from "bun:test";
import {
  BUILDKITE_IO_OBSERVABILITY_VALUES,
  BUILDKITE_KUBE_STATE_METRICS_VALUES,
} from "./grafana-values.ts";

describe("Buildkite I/O observability Helm values", () => {
  it("keeps cAdvisor and pod metadata sampling at 10 seconds", () => {
    expect(
      BUILDKITE_IO_OBSERVABILITY_VALUES.kubelet.serviceMonitor.cAdvisorInterval,
    ).toBe("10s");
    expect(
      BUILDKITE_KUBE_STATE_METRICS_VALUES.prometheus.monitor.http.interval,
    ).toBe("10s");
  });

  it("allowlists only the pod labels needed for CI attribution", () => {
    expect(BUILDKITE_KUBE_STATE_METRICS_VALUES.metricLabelsAllowlist).toEqual([
      "pods=[buildkite.com/job-uuid,ci.sjer.red/step-key]",
    ]);
  });

  it("allowlists only stable Buildkite link and grouping annotations", () => {
    expect(
      BUILDKITE_KUBE_STATE_METRICS_VALUES.metricAnnotationsAllowList,
    ).toEqual([
      "pods=[buildkite.com/build-branch,buildkite.com/build-url,buildkite.com/job-url,buildkite.com/pipeline-slug]",
    ]);
  });

  it("never enables wildcard Kubernetes metadata export", () => {
    const values = JSON.stringify(BUILDKITE_KUBE_STATE_METRICS_VALUES);
    expect(values).not.toContain("[*]");
    expect(values).not.toContain("=[*]");
  });
});
