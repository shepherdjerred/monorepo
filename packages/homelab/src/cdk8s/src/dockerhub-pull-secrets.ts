import { ApiObject, Chart, type App } from "cdk8s";
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
    if (!containsPrivateImage(manifest)) continue;
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
    new OnePasswordItem(chart, `dockerhub-pull-${namespace}`, {
      metadata: { name: dockerHubPullSecretName(namespace), namespace },
      type: "kubernetes.io/dockerconfigjson",
      spec: { itemPath: vaultItemPath(PULL_ITEM_ID) },
    });
  }
}
