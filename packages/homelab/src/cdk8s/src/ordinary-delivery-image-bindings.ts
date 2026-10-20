import { ApiObject, Chart, JsonPatch, type App } from "cdk8s";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { ORDINARY_DELIVERY_ENVIRONMENTS } from "homelab/src/delivery-target-policy.ts";
import { z } from "zod";

const POD_PATHS: Readonly<Record<string, readonly string[]>> = {
  Pod: ["spec"],
  Deployment: ["spec", "template", "spec"],
  StatefulSet: ["spec", "template", "spec"],
  DaemonSet: ["spec", "template", "spec"],
  Job: ["spec", "template", "spec"],
};
const ContainerSchema = z.object({ image: z.string() });

function chartOwnsDependency(
  resource: ApiObject,
  image: string,
  reference: string,
) {
  if (
    image !== "caddy-s3proxy" ||
    !["temporal", "arcade"].includes(Chart.of(resource).node.id)
  )
    return false;
  if (
    reference !== "docker.io/shepherdjerred/caddy-s3proxy:delivery-recipe" &&
    !/^docker\.io\/shepherdjerred\/caddy-s3proxy(?::[\w.-]+)?@sha256:[a-f0-9]{64}$/u.test(
      reference,
    )
  )
    throw new Error(
      "Chart-owned Caddy infrastructure dependency must be pinned by the exact chart digest",
    );
  return true;
}

function bindContainers(
  resource: ApiObject,
  containerPath: readonly string[],
  containers: unknown,
  profile: { images: readonly string[]; controlPlane: boolean },
): void {
  if (containers === undefined) return;
  for (const [index, container] of z
    .array(ContainerSchema)
    .parse(containers)
    .entries()) {
    // Arcade already exposes its original reviewed delivery.image parameter.
    if (container.image.startsWith("{{")) continue;
    const image = /^docker\.io\/shepherdjerred\/([a-z0-9-]+)[:@]/u.exec(
      container.image,
    )?.[1];
    if (image === undefined) continue;
    if (chartOwnsDependency(resource, image, container.image)) continue;
    if (!profile.images.includes(image))
      throw new Error(
        `Chart ${Chart.of(resource).node.id} image ${image} belongs to another release owner`,
      );
    resource.addJsonPatch(
      JsonPatch.replace(
        `/${containerPath.join("/")}/${String(index)}/image`,
        `{{ required \`Delivery requires image:${profile.controlPlane ? "delivery-control-plane" : image}\` (get (get (.Values.delivery | default dict) "images" | default dict) "${profile.controlPlane ? "delivery-control-plane" : image}") }}`,
      ),
    );
  }
}

function centralLabels(
  resource: ApiObject,
  raw: unknown,
): Record<string, string> {
  if (!["Deployment", "StatefulSet"].includes(resource.kind)) return {};
  return z
    .object({
      spec: z.object({
        template: z.object({
          metadata: z.object({ labels: z.record(z.string(), z.string()) }),
        }),
      }),
    })
    .parse(raw).spec.template.metadata.labels;
}

function bindResource(resource: ApiObject, catalog: ServiceIndex) {
  const chart = Chart.of(resource);
  const central = chart.node.id === "temporal";
  const controlPlane = chart.node.id === "delivery-control-plane";
  if (
    !central &&
    !controlPlane &&
    ORDINARY_DELIVERY_ENVIRONMENTS[chart.node.id] === undefined
  )
    return;
  const podPath = POD_PATHS[resource.kind];
  if (podPath === undefined) return;
  const raw = resource.toJson() as unknown;
  const labels = central ? centralLabels(resource, raw) : {};
  if (central && labels["worker-family"] === "central-workflows") return;
  let pod: unknown = raw;
  for (const key of podPath)
    pod = z.record(z.string(), z.unknown()).parse(pod)[key];
  const spec = z.record(z.string(), z.unknown()).parse(pod);
  const protectedRole = [
    "delivery-worker",
    "delivery-tsmc-controller",
    "delivery-platform-worker",
  ].includes(labels["component"] ?? "");
  if (central && protectedRole)
    throw new Error("Delivery control-plane workloads require their own chart");
  const owner = catalog.byChart(chart.node.id);
  if (owner === undefined)
    throw new Error(`Chart ${chart.node.id} has no release owner`);
  for (const field of ["containers", "initContainers"])
    bindContainers(resource, [...podPath, field], spec[field], {
      images: central || controlPlane ? ["temporal-worker"] : owner.images,
      controlPlane,
    });
}

/** Every workload image comes from its frozen Delivery selection. */
export function applyOrdinaryDeliveryImageBindings(app: App): void {
  const catalog = new ServiceIndex();
  for (const resource of app.node.findAll()) {
    if (!ApiObject.isApiObject(resource)) continue;
    bindResource(resource, catalog);
    bindRecipes(resource, resource.toJson(), [], catalog);
  }
}

function bindRecipes(
  resource: ApiObject,
  value: unknown,
  path: string[],
  catalog: ServiceIndex,
): void {
  if (typeof value === "string") {
    const image =
      /^docker\.io\/shepherdjerred\/([a-z0-9-]+):delivery-recipe$/u.exec(
        value,
      )?.[1];
    if (image === undefined) return;
    const chart = Chart.of(resource).node.id;
    const runtime =
      (ORDINARY_DELIVERY_ENVIRONMENTS[chart] !== undefined &&
        catalog.byChart(chart)?.images.includes(image) === true) ||
      (chart === "temporal" && image === "temporal-worker");
    const field = runtime ? "images" : "dependencies";
    resource.addJsonPatch(
      JsonPatch.replace(
        "/" +
          path
            .map((key) => key.replaceAll("~", "~0").replaceAll("/", "~1"))
            .join("/"),
        `{{ required \`Delivery requires image:${image}\` (get (get (.Values.delivery | default dict) "${field}" | default dict) "${image}") }}`,
      ),
    );
  } else if (Array.isArray(value)) {
    for (const [index, child] of value.entries())
      bindRecipes(resource, child, [...path, String(index)], catalog);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value))
      bindRecipes(resource, child, [...path, key], catalog);
  }
}
