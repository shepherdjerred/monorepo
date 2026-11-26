import { IntOrString } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

/**
 * In-cluster HTTP endpoints that more than one chart names: the serving
 * workload binds the port, consumers point an environment variable at the URL,
 * and NetworkPolicies on both ends admit the port. Declaring the endpoint once
 * keeps those three from drifting apart.
 *
 * This module is a leaf: `misc/network-policies.ts` builds its shared egress
 * rules from these handles, so the peer and port shapes are written here
 * rather than imported from it. They render exactly as `nsPeer` and `tcp` do.
 */

export type EndpointProps = {
  /** Namespace the Service and its backend pods run in. */
  namespace: string;
  /** The workload's `app` name; also the Service name unless `service` is set. */
  app: string;
  /** The Service port, which is also the backend pods' container port. */
  port: number;
  /** Name of that port on the container and the Service. */
  portName: string;
  /** Service name when it differs from `app`. */
  service?: string;
  /**
   * Whether the backend pods carry the `app: <app>` label. Pods selected only
   * by a cdk8s-generated or Helm label set this to `false`, and `peer()` then
   * refuses rather than render a selector that matches nothing.
   */
  appLabel?: boolean;
};

export type Endpoint = Readonly<{
  namespace: string;
  app: string;
  service: string;
  port: number;
  portName: string;
  /** Cluster-DNS name of the Service, `<service>.<namespace>.svc.cluster.local`. */
  host: string;
  /** `http://<host>:<port>`, without a trailing slash. */
  url: string;
  /** The port as a NetworkPolicy TCP port. */
  tcp: () => { port: IntOrString; protocol: string };
  /** Every pod in the endpoint's namespace. */
  namespacePeer: () => {
    namespaceSelector: { matchLabels: Record<string, string> };
  };
  /** The endpoint's backend pods: its namespace and `app` label. */
  peer: () => {
    namespaceSelector: { matchLabels: Record<string, string> };
    podSelector: { matchLabels: Record<string, string> };
  };
}>;

/**
 * A typed handle on one in-cluster Service port. Each peer and port it returns
 * is a fresh object, because synthesis mutates NetworkPolicy specs.
 */
export function defineEndpoint(props: EndpointProps): Endpoint {
  const { namespace, app, port, portName } = props;
  const service = props.service ?? app;
  const host = `${service}.${namespace}.svc.cluster.local`;
  const namespacePeer = () => ({
    namespaceSelector: {
      matchLabels: { "kubernetes.io/metadata.name": namespace },
    },
  });
  return {
    namespace,
    app,
    service,
    port,
    portName,
    host,
    url: `http://${host}:${String(port)}`,
    tcp: () => ({ port: IntOrString.fromNumber(port), protocol: "TCP" }),
    namespacePeer,
    peer: () => {
      if (props.appLabel === false)
        throw new Error(
          `${service}.${namespace} pods carry no app label; use namespacePeer()`,
        );
      return { ...namespacePeer(), podSelector: { matchLabels: { app } } };
    },
  };
}

/** Tracker's web server and API (`resources/tracker`). */
export const TRACKER_ENDPOINT = defineEndpoint({
  namespace: "tracker",
  app: "tracker",
  port: 7351,
  portName: "http",
});

/** Experiments' cluster-only Hub and Ops Snapshot listener. */
export const EXPERIMENTS_INTERNAL_ENDPOINT = defineEndpoint({
  namespace: "experiments",
  app: "experiments",
  port: 7408,
  portName: "internal",
});

/** Golink's HTTP server (`resources/golink`). */
export const GOLINK_ENDPOINT = defineEndpoint({
  namespace: "golink",
  app: "golink",
  port: 7352,
  portName: "http",
});

/** Delivery's API (`cdk8s-charts/platform/delivery.ts`). */
export const DELIVERY_ENDPOINT = defineEndpoint({
  namespace: "delivery",
  app: "delivery",
  port: 7353,
  portName: "http",
});

/** Flags's UI and authenticated management routes (`resources/flags`). */
export const FLAGS_MANAGEMENT_ENDPOINT = defineEndpoint({
  namespace: "flags",
  app: "flags",
  port: 7360,
  portName: "http",
});

/** Flags's credentialless evaluation port (`resources/flags`). */
export const FLAGS_EVALUATION_ENDPOINT = defineEndpoint({
  namespace: "flags",
  app: "flags",
  port: 7361,
  portName: "eval",
});

/** Feeds's Tailscale listing console and authenticated refresh API (`resources/feeds`). */
export const FEEDS_ENDPOINT = defineEndpoint({
  namespace: "feeds",
  app: "feeds",
  port: 7430,
  portName: "http",
});

/** Errors's tailnet console and admin API (`resources/errors`). */
export const ERRORS_ADMIN_ENDPOINT = defineEndpoint({
  namespace: "errors",
  app: "errors",
  port: 7370,
  portName: "http",
});

/** Errors's public Sentry-envelope ingest listener (`resources/errors`). */
export const ERRORS_INGEST_ENDPOINT = defineEndpoint({
  namespace: "errors",
  app: "errors",
  service: "errors-ingest",
  port: 7371,
  portName: "ingest",
});

/** The OTLP/HTTP receiver on the trace gateway (`alloy-gateway` Helm chart). */
export const OTLP_GATEWAY_ENDPOINT = defineEndpoint({
  namespace: "alloy-gateway",
  app: "alloy-gateway",
  port: 4318,
  portName: "otlp-http",
  appLabel: false,
});

/** PinchTab's browser automation API (`resources/pinchtab`). */
export const PINCHTAB_ENDPOINT = defineEndpoint({
  namespace: "pinchtab",
  app: "pinchtab",
  port: 9867,
  portName: "http",
  appLabel: false,
});

/** Outbound mail broker UI, health probes, and Prometheus metrics (`resources/mail`). */
export const MAIL_UI_ENDPOINT = defineEndpoint({
  namespace: "mail",
  app: "mail",
  port: 7370,
  portName: "http",
});

/** Outbound mail broker authenticated HTTP submission and receipt API (`resources/mail`). */
export const MAIL_API_ENDPOINT = defineEndpoint({
  namespace: "mail",
  app: "mail",
  port: 7371,
  portName: "api",
});

/** Outbound mail broker in-cluster STARTTLS ESMTP submission listener (`resources/mail`). */
export const MAIL_SMTP_ENDPOINT = defineEndpoint({
  namespace: "mail",
  app: "mail",
  port: 25,
  portName: "smtp",
});
