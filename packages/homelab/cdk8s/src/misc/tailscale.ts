import { Ingress, IngressBackend, IngressProps, Service } from "cdk8s-plus-31";
import { ApiObject } from "cdk8s";
import { JsonPatch } from "cdk8s";
import { Construct } from "constructs";
import { merge } from "lodash";
import { Chart } from "cdk8s";
import { KubeIngress } from "../../generated/imports/k8s.ts";

type ServiceObject = {
  name: string;
  port: number;
};

export class TailscaleIngress extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: Partial<IngressProps> & {
      host: string;
      funnel?: boolean;
      service: Service | ServiceObject;
    },
  ) {
    super(scope, id);

    let base: IngressProps = {
      // unsafe cast, but we know that Ingress only needs the name and port
      // eslint-disable-next-line no-restricted-syntax -- this is unavoidable
      defaultBackend: IngressBackend.fromService(props.service as Service),
      tls: [
        {
          hosts: [props.host],
        },
      ],
    };

    if (props.funnel) {
      base = {
        ...base,
        metadata: {
          annotations: {
            "tailscale.com/funnel": "true",
          },
        },
      };
    }

    const ingress = new Ingress(scope, `${id}-ingress`, merge({}, base, props));

    ApiObject.of(ingress).addJsonPatch(JsonPatch.add("/spec/ingressClassName", "tailscale"));
  }
}

export function createIngress(
  chart: Chart,
  name: string,
  namespace: string,
  service: string,
  port: number,
  hosts: string[],
  funnel: boolean,
) {
  const ingress = new KubeIngress(chart, name, {
    metadata: {
      namespace: namespace,
      annotations: funnel ? { "tailscale.com/funnel": "true" } : {},
    },
    spec: {
      defaultBackend: {
        service: {
          name: service,
          port: {
            number: port,
          },
        },
      },
      ingressClassName: "tailscale",
      tls: [
        {
          hosts: hosts,
        },
      ],
    },
  });
  return ingress;
}
