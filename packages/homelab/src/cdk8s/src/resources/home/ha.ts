import {
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Secret,
  Service,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration } from "cdk8s";
import { withCommonProps } from "../../misc/common.ts";
import { createServiceMonitor } from "../../misc/service-monitor.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import versions from "../../versions.ts";

export function createHaDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "ha", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "HA automation container runs as root",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "HA requires writable filesystem for runtime data",
      },
    },
    podMetadata: {
      labels: { app: "ha" },
    },
  });

  const haTokenItem = new OnePasswordItem(chart, "ha-token", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/a5fjhnycunqy2iag34ls2owzzy",
    },
  });

  const haTokenSecret = Secret.fromSecretName(
    chart,
    "ha-token-secret",
    haTokenItem.name,
  );

  const sentryItem = new OnePasswordItem(chart, "ha-sentry", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/lmjtyjwdnxjsnba7jlsn3vnfhq",
    },
  });

  const sentrySecret = Secret.fromSecretName(
    chart,
    "ha-sentry-secret",
    sentryItem.name,
  );

  deployment.addContainer(
    withCommonProps({
      image: `ghcr.io/shepherdjerred/homelab:${versions["shepherdjerred/homelab"]}`,
      envVariables: {
        HASS_TOKEN: EnvValue.fromSecretValue({
          secret: haTokenSecret,
          key: "password",
        }),
        HASS_BASE_URL: EnvValue.fromValue(
          "http://home-homeassistant-service:8123",
        ),
        METRICS_PORT: EnvValue.fromValue("9090"),

        // Sentry configuration
        SENTRY_ENABLED: EnvValue.fromValue("true"),
        SENTRY_DSN: EnvValue.fromSecretValue({
          secret: sentrySecret,
          key: "credential",
        }),
        SENTRY_ENVIRONMENT: EnvValue.fromValue("production"),
        SENTRY_RELEASE: EnvValue.fromValue(versions["shepherdjerred/homelab"]),
      },
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
        // Pure application container making HTTP calls - no kernel access needed
        privileged: false,
        allowPrivilegeEscalation: false,
      },
      ports: [{ name: "metrics", number: 9090 }],
      liveness: Probe.fromHttpGet("/health", {
        port: 9090,
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      readiness: Probe.fromHttpGet("/health", {
        port: 9090,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(5),
        failureThreshold: 3,
      }),
      volumeMounts: [],
    }),
  );

  // Create Service to expose metrics port
  new Service(chart, "ha-service", {
    metadata: {
      name: "ha-service",
      labels: {
        app: "ha",
      },
    },
    selector: deployment,
    ports: [{ name: "metrics", port: 9090 }],
  });

  // Create ServiceMonitor for Prometheus to scrape HA metrics
  createServiceMonitor(chart, { name: "ha" });
}
