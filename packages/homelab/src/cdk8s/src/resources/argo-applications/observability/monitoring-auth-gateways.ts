import type { Chart } from "cdk8s";
import { ConfigMap } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export const PROMETHEUS_GATEWAY_PORT = 9091;
export const ALERTMANAGER_GATEWAY_PORT = 9094;

// listenLocal makes the operator generate exec probes, but the distroless
// Prometheus image has no shell. HTTP through the same-pod gateway preserves
// the backend's readiness/health endpoints and the operator's probe budgets.
export const PROMETHEUS_HEALTH_PROBE_CONTAINER = {
  name: "prometheus",
  startupProbe: {
    httpGet: { path: "/-/ready", port: PROMETHEUS_GATEWAY_PORT },
    failureThreshold: 60,
    periodSeconds: 15,
    timeoutSeconds: 3,
  },
  readinessProbe: {
    httpGet: { path: "/-/ready", port: PROMETHEUS_GATEWAY_PORT },
    failureThreshold: 3,
    periodSeconds: 5,
    timeoutSeconds: 3,
  },
  livenessProbe: {
    httpGet: { path: "/-/healthy", port: PROMETHEUS_GATEWAY_PORT },
    failureThreshold: 6,
    periodSeconds: 5,
    timeoutSeconds: 3,
  },
};

export const PROMETHEUS_GATEWAY_CONFIG = `{
  admin off
  auto_https off
}

:${PROMETHEUS_GATEWAY_PORT.toString()} {
  route {
    @writeToken {
      path /api/v1/write /api/v1/otlp/*
      header Authorization "Bearer {$PROMETHEUS_WRITE_TOKEN}"
    }
    handle @writeToken {
      reverse_proxy 127.0.0.1:9090
    }

    @writePath path /api/v1/write /api/v1/otlp/*
    respond @writePath "authentication required" 401

    @public path /-/healthy /-/ready /metrics /api/v1/query /api/v1/query_range /api/v1/series /api/v1/labels /api/v1/label/* /api/v1/metadata /api/v1/targets /api/v1/rules /api/v1/alerts /api/v1/query_exemplars /api/v1/status/buildinfo
    handle @public {
      reverse_proxy 127.0.0.1:9090
    }

    handle {
      basic_auth {
        operator {$PROMETHEUS_BASIC_HASH}
      }
      reverse_proxy 127.0.0.1:9090
    }
  }
}
`;

export const ALERTMANAGER_GATEWAY_CONFIG = `{
  admin off
  auto_https off
}

:${ALERTMANAGER_GATEWAY_PORT.toString()} {
  route {
    @silenceToken {
      path /api/v2/silences /api/v2/silences/* /api/v2/silence/*
      method POST DELETE
      header Authorization "Bearer {$ALERTMANAGER_TOKEN}"
    }
    handle @silenceToken {
      reverse_proxy 127.0.0.1:9093
    }

    @silenceMutation {
      path /api/v2/silences /api/v2/silences/* /api/v2/silence/*
      method POST DELETE
    }
    handle @silenceMutation {
      basic_auth {
        operator {$ALERTMANAGER_BASIC_HASH}
      }
      reverse_proxy 127.0.0.1:9093 {
        header_up Authorization "Bearer {$ALERTMANAGER_TOKEN}"
      }
    }

    @public path /-/healthy /-/ready /metrics /api/v2/alerts /api/v2/alerts/* /api/v2/silences /api/v2/silences/* /api/v2/silence/* /api/v2/status /api/v2/receivers
    handle @public {
      reverse_proxy 127.0.0.1:9093
    }

    handle {
      basic_auth {
        operator {$ALERTMANAGER_BASIC_HASH}
      }
      reverse_proxy 127.0.0.1:9093
    }
  }
}
`;

type GatewayContainerProps = Readonly<{
  name: string;
  port: number;
  configMapName: string;
  secretName: string;
  secretEnvironment: Readonly<Record<string, string>>;
}>;

function gatewayContainer(props: GatewayContainerProps) {
  return {
    name: props.name,
    image: `ghcr.io/shepherdjerred/caddy-s3proxy:${versions["shepherdjerred/caddy-s3proxy"]}`,
    command: ["/bin/sh", "-c"],
    args: [
      'printf "%s" "$CADDY_CONFIG" > /tmp/Caddyfile && exec caddy run --config /tmp/Caddyfile --adapter caddyfile',
    ],
    // Embedded CR container ports retain the API's TCP default in live state.
    // Declare it so ArgoCD's server comparison converges after reconciliation.
    ports: [{ name: "auth-web", containerPort: props.port, protocol: "TCP" }],
    env: [
      {
        name: "CADDY_CONFIG",
        valueFrom: {
          configMapKeyRef: { name: props.configMapName, key: "Caddyfile" },
        },
      },
      ...Object.entries(props.secretEnvironment).map(
        ([environmentName, key]) => ({
          name: environmentName,
          valueFrom: { secretKeyRef: { name: props.secretName, key } },
        }),
      ),
    ],
    resources: {
      requests: { cpu: "5m", memory: "16Mi" },
      limits: { cpu: "100m", memory: "64Mi" },
    },
    securityContext: {
      runAsNonRoot: true,
      runAsUser: 1000,
      runAsGroup: 2000,
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      seccompProfile: { type: "RuntimeDefault" },
    },
    volumeMounts: [{ name: "auth-gateway-tmp", mountPath: "/tmp" }],
  };
}

export function createMonitoringAuthGateways(chart: Chart) {
  const auth = new OnePasswordItem(chart, "monitoring-api-auth-onepassword", {
    spec: { itemPath: vaultItemPath("gnx5xq5rrsdlncvajjc4i577gm") },
    metadata: {
      name: "prometheus-monitoring-api-auth",
      namespace: "prometheus",
    },
  });
  const prometheusConfig = new ConfigMap(
    chart,
    "prometheus-auth-gateway-config",
    {
      metadata: {
        name: "prometheus-auth-gateway-config",
        namespace: "prometheus",
      },
      data: { Caddyfile: PROMETHEUS_GATEWAY_CONFIG },
    },
  );
  const alertmanagerConfig = new ConfigMap(
    chart,
    "alertmanager-auth-gateway-config",
    {
      metadata: {
        name: "alertmanager-auth-gateway-config",
        namespace: "prometheus",
      },
      data: { Caddyfile: ALERTMANAGER_GATEWAY_CONFIG },
    },
  );

  const prometheusContainer = gatewayContainer({
    name: "authenticated-gateway",
    port: PROMETHEUS_GATEWAY_PORT,
    configMapName: prometheusConfig.name,
    secretName: auth.name,
    secretEnvironment: {
      PROMETHEUS_BASIC_HASH: "prometheus-basic-hash",
      PROMETHEUS_WRITE_TOKEN: "prometheus-write-token",
    },
  });

  return {
    alertmanagerContainer: gatewayContainer({
      name: "authenticated-gateway",
      port: ALERTMANAGER_GATEWAY_PORT,
      configMapName: alertmanagerConfig.name,
      secretName: auth.name,
      secretEnvironment: {
        ALERTMANAGER_BASIC_HASH: "alertmanager-basic-hash",
        ALERTMANAGER_TOKEN: "alertmanager-token",
      },
    }),
    prometheusContainer,
    prometheusContainers: [
      PROMETHEUS_HEALTH_PROBE_CONTAINER,
      prometheusContainer,
    ],
  };
}
