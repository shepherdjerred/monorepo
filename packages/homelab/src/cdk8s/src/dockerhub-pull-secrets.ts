import { ApiObject, Chart, JsonPatch, type App } from "cdk8s";
import { z } from "zod";
import { imageRegistry } from "@shepherdjerred/version-catalog/image-registry";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "./misc/onepassword-vault.ts";

export function dockerHubPullSecretName(namespace: string): string {
  return `dockerhub-pull-${namespace}`;
}
const PULL_ITEM_ID = "ngzmppq52zm7sii6ato2mv3sbi";
const privateImages = new Set(
  imageRegistry.images
    .filter((image) => image.visibility === "private")
    .map((image) => image.name),
);
const applicationDestination = z.object({
  spec: z.object({ destination: z.object({ namespace: z.string().min(1) }) }),
});

function existingPullSecret(app: App, namespace: string): boolean {
  const matches = app.node
    .findAll()
    .filter(
      (resource) =>
        ApiObject.isApiObject(resource) &&
        resource.kind === "OnePasswordItem" &&
        resource.metadata.name === dockerHubPullSecretName(namespace) &&
        resource.metadata.namespace === namespace,
    );
  const [existing] = matches;
  if (existing === undefined) return false;
  if (matches.length !== 1)
    throw new Error(`Duplicate registry reader in ${namespace}`);
  z.object({
    type: z.literal("kubernetes.io/dockerconfigjson"),
    spec: z.object({ itemPath: z.literal(vaultItemPath(PULL_ITEM_ID)) }),
  }).parse(ApiObject.of(existing).toJson());
  return true;
}

function containsPrivateImage(value: unknown): boolean {
  if (typeof value === "string") {
    // Runtime-created pods can appear only in serialized admission allowlists.
    for (const match of value.matchAll(
      /(?:^|[\s"'])(?:ghcr\.io|docker\.io)\/shepherdjerred\/([\w-]+)(?:[:@]|$)/gu,
    )) {
      const name = match[1];
      if (name !== undefined && privateImages.has(name)) return true;
    }
    return false;
  }
  return Array.isArray(value)
    ? value.some((child: unknown) => containsPrivateImage(child))
    : value !== null &&
        typeof value === "object" &&
        Object.values(value).some((child: unknown) =>
          containsPrivateImage(child),
        );
}

/** Prepare reader-only registry credentials before the image-reference cutover. */
export function prepareDockerHubPullSecrets(app: App): void {
  const namespaces = new Map<string, Chart>();
  for (const construct of app.node.findAll()) {
    if (!ApiObject.isApiObject(construct)) continue;
    const manifest: unknown = construct.toJson();
    if (!containsPrivateImage(manifest) && !hasTemplatedPodImage(construct))
      continue;
    const chart = Chart.of(construct);
    const namespace =
      construct.kind === "Application"
        ? applicationDestination.parse(manifest).spec.destination.namespace
        : (construct.metadata.namespace ?? chart.namespace);
    if (namespace === undefined || namespace === "") {
      throw new Error(
        `Private image consumer ${construct.node.path} has no namespace`,
      );
    }
    namespaces.set(namespace, chart);
  }
  // Woodpecker owns its CI namespace credential declaration alongside grants.
  namespaces.delete("woodpecker-ci");
  for (const [namespace, chart] of namespaces) {
    if (existingPullSecret(app, namespace)) continue;
    new OnePasswordItem(chart, `dockerhub-pull-${namespace}`, {
      metadata: { name: dockerHubPullSecretName(namespace), namespace },
      type: "kubernetes.io/dockerconfigjson",
      spec: { itemPath: vaultItemPath(PULL_ITEM_ID) },
    });
  }
}

const podSpecPaths: Readonly<Record<string, readonly string[]>> = {
  Pod: ["spec"],
  Deployment: ["spec", "template", "spec"],
  StatefulSet: ["spec", "template", "spec"],
  DaemonSet: ["spec", "template", "spec"],
  ReplicaSet: ["spec", "template", "spec"],
  Job: ["spec", "template", "spec"],
};
const PodSpecSchema = z.object({
  containers: z.array(z.object({ image: z.string() })),
  initContainers: z.array(z.object({ image: z.string() })).optional(),
  imagePullSecrets: z.array(z.object({ name: z.string().min(1) })).optional(),
});

function hasTemplatedPodImage(resource: ApiObject): boolean {
  const path = podSpecPaths[resource.kind];
  if (path === undefined) return false;
  let value: unknown = resource.toJson();
  for (const field of path)
    value = z.record(z.string(), z.unknown()).parse(value)[field];
  const spec = PodSpecSchema.parse(value);
  return [...spec.containers, ...(spec.initContainers ?? [])].some(
    ({ image }) => image.includes("{{"),
  );
}

/** Attach the namespace's reader secret to repo-owned private Pod templates. */
export function attachDockerHubPullSecrets(app: App): void {
  for (const construct of app.node.findAll()) {
    if (!ApiObject.isApiObject(construct)) continue;
    const path = podSpecPaths[construct.kind];
    if (path === undefined) continue;
    let value: unknown = construct.toJson();
    for (const field of path) {
      value = z.record(z.string(), z.unknown()).parse(value)[field];
    }
    const spec = PodSpecSchema.parse(value);
    const images = [...spec.containers, ...(spec.initContainers ?? [])];
    if (
      !images.some(
        ({ image }) => containsPrivateImage(image) || image.includes("{{"),
      )
    )
      continue;
    const namespace =
      construct.metadata.namespace ?? Chart.of(construct).namespace;
    if (namespace === undefined || namespace === "")
      throw new Error(
        `Private Pod template ${construct.node.path} has no namespace`,
      );
    const name = dockerHubPullSecretName(namespace);
    const secrets = spec.imagePullSecrets ?? [];
    // Unknown image templates receive the same reader: dynamic syntax cannot
    // hide a private runtime image from namespace credential preparation.
    if (secrets.some((secret) => secret.name === name)) continue;
    construct.addJsonPatch(
      JsonPatch.add(`/${path.join("/")}/imagePullSecrets`, [
        ...secrets,
        { name },
      ]),
    );
  }
}
