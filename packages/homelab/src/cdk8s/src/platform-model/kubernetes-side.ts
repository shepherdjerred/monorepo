import { z } from "zod";
import {
  objectIdentity,
  synthesizedCharts,
  type SynthesizedObject,
} from "@shepherdjerred/homelab/cdk8s/src/testing/synthesized-charts.ts";
import { tailnetNamesIn } from "./tailnet-names.ts";

/**
 * What the synthesized manifests render for the facts in the platform model.
 * Read from the charts as synthesis publishes them, never from source text.
 */
export type KubernetesSide = {
  tunnelBindings: readonly {
    namespace: string;
    hostname: string;
    service: string;
  }[];
  /** Site blocks of the static-site origin's Caddyfile. */
  caddySites: readonly { hostname: string; bucket: string | undefined }[];
  tailnetDevices: readonly {
    namespace: string;
    /** `undefined` for a workload that names itself on the tailnet. */
    host: string | undefined;
    exposure: "ingress" | "loadBalancer" | "tsnet";
    /** `undefined` when the operator's default proxy tags apply. */
    tags: readonly string[] | undefined;
  }[];
  onePasswordItems: readonly {
    namespace: string;
    vaultId: string;
    /** The item title or ID the path ends in. */
    item: string;
  }[];
  /** Every container environment variable with a literal value. */
  environment: readonly { namespace: string; name: string; value: string }[];
  /** Every `<host>.<tailnet>` name in any rendered object. */
  tailnetNames: readonly { host: string; domain: string }[];
};

const TunnelBindingSchema = z.looseObject({
  subjects: z.array(
    z.looseObject({
      name: z.string(),
      spec: z.looseObject({ fqdn: z.string() }),
    }),
  ),
});

const AnnotationsSchema = z.looseObject({
  metadata: z.looseObject({
    annotations: z.record(z.string(), z.string()).optional(),
  }),
});

const IngressSchema = z.looseObject({
  spec: z.looseObject({
    ingressClassName: z.string().optional(),
    tls: z.array(z.looseObject({ hosts: z.array(z.string()) })).optional(),
  }),
});

const ServiceSchema = z.looseObject({
  spec: z.looseObject({ loadBalancerClass: z.string().optional() }),
});

const OnePasswordItemSchema = z.looseObject({
  spec: z.looseObject({
    itemPath: z.string().regex(/^vaults\/[^/]+\/items\/[^/]+$/),
  }),
});

const ContainerSchema = z.looseObject({
  env: z
    .array(z.looseObject({ name: z.string(), value: z.string().optional() }))
    .optional(),
});
const WorkloadSchema = z.looseObject({
  spec: z.looseObject({
    template: z.looseObject({
      spec: z.looseObject({
        containers: z.array(ContainerSchema),
        initContainers: z.array(ContainerSchema).optional(),
      }),
    }),
  }),
});

const ConfigMapSchema = z.looseObject({
  data: z.record(z.string(), z.string()).optional(),
});

const WORKLOAD_KINDS = new Set([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
]);
const TAGS_ANNOTATION = "tailscale.com/tags";

function namespaceOf(object: SynthesizedObject): string {
  const { namespace } = object.metadata;
  if (namespace === undefined)
    throw new Error(`${objectIdentity(object)} has no namespace`);
  return namespace;
}

function tagsOf(object: SynthesizedObject): string[] | undefined {
  return AnnotationsSchema.parse(object)
    .metadata.annotations?.[TAGS_ANNOTATION]?.split(",")
    .map((tag) => tag.trim());
}

/** The `http://<host> { ... }` site blocks of a generated Caddyfile. */
export function caddySitesIn(caddyfile: string): KubernetesSide["caddySites"] {
  return caddyfile.split(/^(?=http:\/\/\S+ \{$)/m).flatMap((block) => {
    const hostname = /^http:\/\/(\S+) \{$/m.exec(block)?.[1];
    return hostname === undefined
      ? []
      : [{ hostname, bucket: /^\s*bucket (\S+)$/m.exec(block)?.[1] }];
  });
}

function tailnetDevice(
  object: SynthesizedObject,
): KubernetesSide["tailnetDevices"][number][] {
  if (object.kind === "Ingress") {
    const namespace = namespaceOf(object);
    const { spec } = IngressSchema.parse(object);
    if (spec.ingressClassName !== "tailscale") return [];
    const hosts = (spec.tls ?? []).flatMap((entry) => entry.hosts);
    if (hosts.length === 0)
      throw new Error(`${objectIdentity(object)} names no tailnet host`);
    return hosts.map((host) => ({
      namespace,
      host,
      exposure: "ingress",
      tags: tagsOf(object),
    }));
  }
  if (object.kind === "Service") {
    if (ServiceSchema.parse(object).spec.loadBalancerClass !== "tailscale")
      return [];
    const host =
      AnnotationsSchema.parse(object).metadata.annotations?.[
        "tailscale.com/hostname"
      ];
    if (host === undefined)
      throw new Error(`${objectIdentity(object)} names no tailnet host`);
    return [
      {
        namespace: namespaceOf(object),
        host,
        exposure: "loadBalancer",
        tags: tagsOf(object),
      },
    ];
  }
  return [];
}

export async function readKubernetesSide(): Promise<KubernetesSide> {
  // A companion chart can render the same object as its owner chart.
  const byIdentity = new Map<string, SynthesizedObject>();
  const charts = await synthesizedCharts();
  for (const objects of charts.values())
    for (const object of objects)
      byIdentity.set(objectIdentity(object), object);
  const objects = [...byIdentity.values()];

  const environment = objects
    .filter((object) => WORKLOAD_KINDS.has(object.kind))
    .flatMap((object) => {
      const pod = WorkloadSchema.parse(object).spec.template.spec;
      return [...pod.containers, ...(pod.initContainers ?? [])].flatMap(
        (container) =>
          (container.env ?? []).flatMap(({ name, value }) =>
            value === undefined
              ? []
              : [{ namespace: namespaceOf(object), name, value }],
          ),
      );
    });

  return {
    tunnelBindings: objects
      .filter((object) => object.kind === "TunnelBinding")
      .flatMap((object) => {
        const binding = TunnelBindingSchema.parse(object);
        return binding.subjects.map((subject) => ({
          namespace: namespaceOf(object),
          hostname: subject.spec.fqdn,
          service: subject.name,
        }));
      }),
    caddySites: objects
      .filter((object) => object.kind === "ConfigMap")
      .flatMap((object) =>
        caddySitesIn(ConfigMapSchema.parse(object).data?.["Caddyfile"] ?? ""),
      ),
    tailnetDevices: [
      ...objects.flatMap((object) => tailnetDevice(object)),
      ...environment
        .filter((variable) => variable.name === "TS_ADVERTISE_TAGS")
        .map((variable) => ({
          namespace: variable.namespace,
          host: undefined,
          exposure: "tsnet" as const,
          tags: variable.value.split(",").map((tag) => tag.trim()),
        })),
    ],
    onePasswordItems: objects
      .filter((object) => object.kind === "OnePasswordItem")
      .map((object) => {
        const [, vaultId = "", , item = ""] =
          OnePasswordItemSchema.parse(object).spec.itemPath.split("/");
        return { namespace: namespaceOf(object), vaultId, item };
      }),
    environment,
    tailnetNames: tailnetNamesIn(JSON.stringify(objects)),
  };
}
