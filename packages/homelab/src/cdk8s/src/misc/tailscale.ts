import type { IngressProps } from "cdk8s-plus-31";
import type { Service } from "cdk8s-plus-31";
import { Ingress, IngressBackend } from "cdk8s-plus-31";
import { ApiObject, Chart, JsonPatch } from "cdk8s";
import { Construct } from "constructs";
import { merge } from "lodash";
import { KubeIngress } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import type { ProbeModule } from "./blackbox-modules.ts";
import { registerBackendProbe } from "./probe-registry.ts";

function requireChartNamespace(chart: Chart, context: string): string {
  if (chart.namespace == null) {
    throw new Error(
      `${context}: cannot auto-register a blackbox probe — the chart has no namespace set.`,
    );
  }
  return chart.namespace;
}

export class TailscaleIngress extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: Partial<IngressProps> & {
      host: string;
      service: Service;
      /** Required when the backing service exposes more than one port. */
      port?: number;
      /** Blackbox probe module override. Defaults to "http_2xx". */
      probeModule?: ProbeModule;
      /**
       * Skip auto-registering a blackbox probe for this service. Rare — must
       * carry a comment at the call site explaining why (e.g. the service
       * can't meaningfully be health-checked over HTTP/TCP).
       */
      disableProbe?: boolean;
    },
  ) {
    super(scope, id);

    const base: IngressProps = {
      defaultBackend: IngressBackend.fromService(
        props.service,
        props.port == null ? undefined : { port: props.port },
      ),
      tls: [
        {
          hosts: [props.host],
        },
      ],
    };

    const ingress = new Ingress(scope, `${id}-ingress`, merge({}, base, props));

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
    hosts: string[];
    /** Blackbox probe module override. Defaults to "http_2xx". */
    probeModule?: ProbeModule;
    /** Rare escape hatch — must carry a comment explaining why. */
    disableProbe?: boolean;
  },
) {
  const ingress = new KubeIngress(chart, name, {
    metadata: {
      namespace: options.namespace,
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
      tls: [
        {
          hosts: options.hosts,
        },
      ],
    },
  });

  if (options.disableProbe !== true) {
    registerBackendProbe({
      namespace: options.namespace,
      serviceName: options.service,
      port: options.port,
      module: options.probeModule,
    });
  }

  return ingress;
}
