import { describe, expect, it } from "vitest";
import {
  CI_IO_OBSERVABILITY_VALUES,
  CI_KUBE_STATE_METRICS_VALUES,
  GRAFANA_ADDITIONAL_DATASOURCES,
  GRAFANA_DATASOURCE_HASH_ANNOTATION,
  createGrafanaValues,
  grafanaDatasourceConfigHash,
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

describe("Grafana datasource provisioning", () => {
  const values = createGrafanaValues("renderer-secret");

  // A watch sidecar races Grafana's startup provisioning and then depends on a
  // server-admin reload credential; the init container removes both.
  it("syncs datasources once in an init container without a reload call", () => {
    expect(values.sidecar?.["datasources"]).toMatchObject({
      initDatasources: true,
      watchMethod: "LIST",
      skipReload: true,
    });
  });

  it("rolls Grafana when the provisioned datasource config changes", () => {
    const podAnnotations = values["podAnnotations"];
    expect(podAnnotations).toEqual({
      [GRAFANA_DATASOURCE_HASH_ANNOTATION]: grafanaDatasourceConfigHash(),
    });
    expect(grafanaDatasourceConfigHash()).toMatch(/^[0-9a-f]{12}$/);
  });

  it("provisions the Loki, Tempo, and Pyroscope datasources", () => {
    expect(values["additionalDataSources"]).toBe(
      GRAFANA_ADDITIONAL_DATASOURCES,
    );
    expect(
      GRAFANA_ADDITIONAL_DATASOURCES.map((datasource) => datasource.uid),
    ).toEqual(["loki", "tempo", "pyroscope"]);
  });
});
