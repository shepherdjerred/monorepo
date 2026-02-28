import type { IngressProps } from "cdk8s-plus-31";
import type { Service } from "cdk8s-plus-31";
import { Ingress, IngressBackend } from "cdk8s-plus-31";
import { ApiObject } from "cdk8s";
import { JsonPatch } from "cdk8s";
import { Construct } from "constructs";
import { merge } from "lodash";
import type { Chart } from "cdk8s";
import { KubeIngress } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

export class TailscaleIngress extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: Partial<IngressProps> & {
      host: string;
      service: Service;
    },
  ) {
    super(scope, id);

    const base: IngressProps = {
      defaultBackend: IngressBackend.fromService(props.service),
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
  return ingress;
}
