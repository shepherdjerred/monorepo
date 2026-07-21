import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

const GRAFANA_RENDERER_TOKEN_KEY = "GRAFANA_RENDERER_TOKEN";

type KubePrometheusStackValues = HelmValuesForChart<"kube-prometheus-stack">;
type GrafanaValues = NonNullable<KubePrometheusStackValues["grafana"]>;
type GrafanaSidecarValues = NonNullable<GrafanaValues["sidecar"]>;
type GrafanaDashboardSidecarValues = Omit<
  NonNullable<GrafanaSidecarValues["dashboards"]>,
  "labelValue"
> & {
  labelValue?: string;
};
type GrafanaValuesWithStringDashboardLabel = Omit<GrafanaValues, "sidecar"> & {
  sidecar?: Omit<GrafanaSidecarValues, "dashboards"> & {
    dashboards?: GrafanaDashboardSidecarValues;
  };
};

export type PrometheusValuesWithBlackbox = Omit<
  KubePrometheusStackValues,
  "grafana"
> & {
  grafana?: GrafanaValuesWithStringDashboardLabel;
  "prometheus-blackbox-exporter"?: {
    enabled?: boolean;
    config?: {
      modules?: Record<
        string,
        {
          prober: string;
          timeout?: string;
          http?: {
            valid_http_versions?: string[];
            valid_status_codes?: number[];
            follow_redirects?: boolean;
            preferred_ip_protocol?: string;
            fail_if_body_not_matches_regexp?: string[];
          };
        }
      >;
    };
  };
};

export function createGrafanaValues(
  rendererSecretName: string,
): NonNullable<PrometheusValuesWithBlackbox["grafana"]> {
  return {
    "grafana.ini": {
      database: {
        type: "postgres",
        host: "grafana-postgresql:5432",
        name: "grafana",
        user: "grafana",
        ssl_mode: "require",
        password: "$__file{/etc/secrets/postgres/password}",
      },
      feature_toggles: {
        provisioning: true,
        kubernetesDashboards: true,
        grafanaAdvisor: true,
      },
      rendering: {
        server_url:
          "http://prometheus-grafana-image-renderer.prometheus:8081/render",
        callback_url: "http://prometheus-grafana.prometheus:80/",
        renderer_token: `$__env{${GRAFANA_RENDERER_TOKEN_KEY}}`,
      },
    },
    envValueFrom: {
      [GRAFANA_RENDERER_TOKEN_KEY]: {
        secretKeyRef: {
          name: rendererSecretName,
          key: GRAFANA_RENDERER_TOKEN_KEY,
        },
      },
    },
    defaultDashboardsEnabled: true,
    // Baseline request (no limits) so dashboards aren't BestEffort.
    // 30d peak ~55m / ~910Mi.
    resources: {
      requests: {
        cpu: "50m",
        memory: "512Mi",
      },
    },
    imageRenderer: {
      enabled: true,
      serverURL:
        "http://prometheus-grafana-image-renderer.prometheus:8081/render",
      renderingCallbackURL: "http://prometheus-grafana.prometheus:80/",
      env: {
        HTTP_HOST: "0.0.0.0",
        XDG_CONFIG_HOME: "/tmp/.chromium",
        XDG_CACHE_HOME: "/tmp/.chromium",
      },
    },
    extraSecretMounts: [
      {
        name: "postgres-secret-mount",
        secretName:
          "grafana.grafana-postgresql.credentials.postgresql.acid.zalan.do",
        defaultMode: 0o440,
        mountPath: "/etc/secrets/postgres",
        readOnly: true,
      },
    ],
    persistence: {
      enabled: true,
      storageClassName: NVME_STORAGE_CLASS,
      labels: {
        "velero.io/backup": "enabled",
      },
    },
    useStatefulSet: true,
    sidecar: {
      dashboards: {
        label: "homelab_grafana_dashboard",
        labelValue: "1",
        searchNamespace: "ALL",
        provider: {
          allowUiUpdates: false,
        },
      },
      datasources: {
        alertmanager: {
          handleGrafanaManagedAlerts: true,
        },
      },
    },
    prune: true,
    additionalDataSources: [
      {
        name: "loki",
        uid: "loki",
        editable: false,
        type: "loki",
        url: "http://loki-gateway.loki",
        version: 1,
      },
      {
        name: "tempo",
        uid: "tempo",
        editable: false,
        type: "tempo",
        url: "http://tempo.tempo.svc:3200",
        version: 1,
        jsonData: {
          tracesToLogsV2: {
            datasourceUid: "loki",
            spanStartTimeShift: "-5m",
            spanEndTimeShift: "5m",
            tags: [{ key: "service.name", value: "service_name" }],
            filterByTraceID: true,
            customQuery: false,
          },
          serviceMap: { datasourceUid: "prometheus" },
          nodeGraph: { enabled: true },
        },
      },
      {
        // Continuous profiling store fed by the Alloy eBPF DaemonSet. Flame
        // graphs are grouped by service_name = <namespace>/<container>.
        name: "pyroscope",
        uid: "pyroscope",
        editable: false,
        // Must be the datasource plugin ID. "grafanapyroscope" is not a
        // registered plugin (health check returns plugin.notRegistered), which
        // left this datasource dead and Profiles Drilldown reporting "Missing
        // Pyroscope data source".
        type: "grafana-pyroscope-datasource",
        url: "http://pyroscope.pyroscope.svc.cluster.local:4040",
        // Bump above the live Grafana DB version when changing provisioned
        // datasource identity fields, or Grafana leaves the stale row in place.
        version: 3,
      },
    ],
  };
}
