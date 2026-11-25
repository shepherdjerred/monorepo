import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, EnvValue, Pods, Service } from "cdk8s-plus-31";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import {
  ERRORS_ADMIN_ENDPOINT,
  ERRORS_INGEST_ENDPOINT,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";
import {
  FirstPartyWebService,
  type FirstPartyServerContainer,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  cloudflareTunnelIngressRule,
  dnsEgressRule,
  nsPeer,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/**
 * Activation gate. While it is false the chart publishes an inactive marker
 * and the root renders no Argo Application, so nothing deploys. Activating the
 * service is a reviewed change of its own: see the wiki how-to "Add a hosted
 * service".
 */
export const ERRORS_ACTIVE = false;

const ERRORS_UID = 1000;

function buildErrorsServerContainer(): FirstPartyServerContainer {
  const containerSecurity = restrictedContainer(ERRORS_UID);
  const envVariables: Record<string, EnvValue> = {
    ENVIRONMENT: EnvValue.fromValue("production"),
    ERRORS_INGEST_PORT: EnvValue.fromValue(String(ERRORS_INGEST_ENDPOINT.port)),
    HOME: EnvValue.fromValue("/tmp"),
    HOST: EnvValue.fromValue("0.0.0.0"),
    PORT: EnvValue.fromValue(String(ERRORS_ADMIN_ENDPOINT.port)),
  };
  return {
    image: firstPartyImageRecipe("errors"),
    securityContext: containerSecurity,
    resources: {
      cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
      memory: { request: Size.mebibytes(64), limit: Size.mebibytes(256) },
    },
    envVariables,
  };
}

export function createErrorsDeployment(chart: Chart) {
  const webService = new FirstPartyWebService(chart, "errors-web-service", {
    name: ERRORS_ADMIN_ENDPOINT.app,
    port: ERRORS_ADMIN_ENDPOINT.port,
    probes: { live: "/healthz", ready: "/healthz" },
    containers: () => ({
      server: buildErrorsServerContainer(),
    }),
    serviceName: ERRORS_ADMIN_ENDPOINT.service,
    tailscale: {
      probePath: "/healthz",
      hosts: [
        {
          id: "errors-ingress",
          // A prepared service renders nothing, so the platform model cannot
          // declare its tailnet name yet. Activation declares "errors" in
          // platform-model.json and replaces this with tailnetService("errors").
          host: {
            host: "errors",
            namespace: ERRORS_ADMIN_ENDPOINT.namespace,
            exposure: "ingress",
          },
        },
      ],
    },
    policies: [
      {
        name: "errors-app-netpol",
        selects: "app",
        ingress: [
          {
            from: [nsPeer("tailscale"), nsPeer("prometheus")],
            ports: [ERRORS_ADMIN_ENDPOINT.tcp()],
          },
          cloudflareTunnelIngressRule([ERRORS_INGEST_ENDPOINT.port]),
        ],
        // Add an egress rule for each dependency the service calls.
        egress: [dnsEgressRule()],
      },
    ],
  });

  const serverContainer = webService.deployment.containers[0];
  if (serverContainer === undefined) {
    throw new Error("Expected server container on errors Deployment");
  }
  serverContainer.addPort({
    name: ERRORS_INGEST_ENDPOINT.portName,
    number: ERRORS_INGEST_ENDPOINT.port,
  });

  new Service(chart, "errors-ingest-service", {
    metadata: { name: ERRORS_INGEST_ENDPOINT.service },
    selector: Pods.select(chart, "errors-ingest-selector", {
      labels: { app: ERRORS_INGEST_ENDPOINT.app },
    }),
    ports: [
      {
        port: ERRORS_INGEST_ENDPOINT.port,
        name: ERRORS_INGEST_ENDPOINT.portName,
      },
    ],
  });

  return webService;
}
