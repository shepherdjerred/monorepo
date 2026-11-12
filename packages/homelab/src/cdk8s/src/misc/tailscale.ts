import type { IngressProps } from "cdk8s-plus-31";
import type { Service } from "cdk8s-plus-31";
import { Ingress, IngressBackend } from "cdk8s-plus-31";
import { ApiObject, Chart, JsonPatch } from "cdk8s";
import { Construct } from "constructs";
import { merge } from "lodash";
import { KubeIngress } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import type { TailnetService } from "homelab/src/platform-model.ts";
import type { ProbeModule } from "./probes/blackbox-modules.ts";
import { registerBackendProbe } from "./probes/probe-registry.ts";

export const TAILSCALE_PROXY_CLASSES = ["standard", "medium", "heavy"] as const;
export type TailscaleProxyClass = (typeof TAILSCALE_PROXY_CLASSES)[number];

function requireChartNamespace(chart: Chart, context: string): string {
  if (chart.namespace == null) {
    throw new Error(
      `${context}: cannot auto-register a blackbox probe — the chart has no namespace set.`,
    );
  }
  return chart.namespace;
}

const TAGS_ANNOTATION = "tailscale.com/tags";

/**
 * The tags a tailnet service declares, as the operator and `tailscaled` read
 * them. A service without tags of its own takes the operator's defaults and
 * renders none.
 */
export function tailnetTags(service: TailnetService): string {
  if (service.tags === undefined)
    throw new Error(
      `Tailnet service ${service.host} declares no tags in platform-model.json`,
    );
  return service.tags.join(",");
}

/**
 * The hosts of an Ingress the Tailscale operator proxies, and the tags
 * annotation their model entries call for. Each host must be a model entry
 * (`tailnetService(...)`) for this namespace, exposed as an Ingress.
 */
function operatorIngress(
  context: string,
  namespace: string | undefined,
  services: readonly TailnetService[],
): { hosts: string[]; annotations: Record<string, string> | undefined } {
  for (const service of services) {
    if (
      service.exposure !== "ingress" ||
      (namespace !== undefined && service.namespace !== namespace)
    )
      throw new Error(
        `${context}: platform-model.json declares tailnet service ${service.host} as ${service.exposure} in ${service.namespace}, not an ingress in ${namespace ?? "<no namespace>"}`,
      );
  }
  const tagged = services.filter((service) => service.tags !== undefined);
  const tags = [...new Set(tagged.map((service) => tailnetTags(service)))];
  if (
    tags.length > 1 ||
    (tags.length === 1 && tagged.length !== services.length)
  )
    throw new Error(
      `${context}: the hosts of one Ingress must declare the same tags`,
    );
  const [value] = tags;
  return {
    hosts: services.map((service) => service.host),
    annotations: value === undefined ? undefined : { [TAGS_ANNOTATION]: value },
  };
}

export class TailscaleIngress extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: Partial<IngressProps> & {
      /** The model's entry for the tailnet name: `tailnetService("<host>")`. */
      host: TailnetService;
      service: Service;
      /** Required when the backing service exposes more than one port. */
      port?: number;
      /** Blackbox probe module override. Defaults to "http_2xx". */
      probeModule?: ProbeModule;
      /** Resource profile for the operator-managed proxy StatefulSet. */
      proxyClass?: TailscaleProxyClass;
      /**
       * URL path the in-cluster HTTP probe requests (e.g. "/ready"). Point
       * this at a real health endpoint when the service doesn't return 2xx
       * at "/". Ignored by a `tcp_connect` probeModule. Defaults to "/".
       */
      probePath?: string;
      /**
       * Skip auto-registering a blackbox probe for this service. Rare — must
       * carry a comment at the call site explaining why (e.g. the service
       * can't meaningfully be health-checked over HTTP/TCP).
       */
      disableProbe?: boolean;
    },
  ) {
    super(scope, id);

    const { proxyClass, host, ...ingressProps } = props;
    const { hosts, annotations } = operatorIngress(
      `TailscaleIngress(${id})`,
      Chart.of(scope).namespace,
      [host],
    );
    const base: IngressProps = {
      metadata:
        proxyClass === undefined && annotations === undefined
          ? undefined
          : {
              ...(annotations === undefined ? {} : { annotations }),
              ...(proxyClass === undefined
                ? {}
                : { labels: { "tailscale.com/proxy-class": proxyClass } }),
            },
      defaultBackend: IngressBackend.fromService(
        ingressProps.service,
        ingressProps.port == null ? undefined : { port: ingressProps.port },
      ),
      tls: [{ hosts }],
    };

    const ingress = new Ingress(
      scope,
      `${id}-ingress`,
      merge({}, base, ingressProps),
    );

    ApiObject.of(ingress).addJsonPatch(
      JsonPatch.add("/spec/ingressClassName", "tailscale"),
    );

    if (props.disableProbe !== true) {
      registerBackendProbe({
        namespace: requireChartNamespace(
          Chart.of(this),
          `TailscaleIngress(${id})`,
        ),
        serviceName: props.service.name,
        port: props.port ?? props.service.port,
        module: props.probeModule,
        path: props.probePath,
      });
    }
  }
}

export function createIngress(
  chart: Chart,
  name: string,
  options: {
    namespace: string;
    service: string;
    port: number;
    /** The model's entries for the tailnet names: `tailnetService("<host>")`. */
    hosts: TailnetService[];
    /** Blackbox probe module override. Defaults to "http_2xx". */
    probeModule?: ProbeModule;
    /**
     * URL path the in-cluster HTTP probe requests (e.g. "/ready"). Point
     * this at a real health endpoint when the service doesn't return 2xx
     * at "/". Ignored by a `tcp_connect` probeModule. Defaults to "/".
     */
    probePath?: string;
    /** Resource profile for the operator-managed proxy StatefulSet. */
    proxyClass?: TailscaleProxyClass;
    /** Rare escape hatch — must carry a comment explaining why. */
    disableProbe?: boolean;
  },
) {
  const { hosts, annotations } = operatorIngress(
    `createIngress(${name})`,
    options.namespace,
    options.hosts,
  );
  const ingress = new KubeIngress(chart, name, {
    metadata: {
      namespace: options.namespace,
      ...(annotations === undefined ? {} : { annotations }),
      labels:
        options.proxyClass === undefined
          ? undefined
          : { "tailscale.com/proxy-class": options.proxyClass },
    },
    spec: {
      defaultBackend: {
        service: {
          name: options.service,
          port: {
            number: options.port,
          },
        },
      },
      ingressClassName: "tailscale",
      tls: [{ hosts }],
    },
  });

  if (options.disableProbe !== true) {
    registerBackendProbe({
      namespace: options.namespace,
      serviceName: options.service,
      port: options.port,
      module: options.probeModule,
      path: options.probePath,
    });
  }

  return ingress;
}
