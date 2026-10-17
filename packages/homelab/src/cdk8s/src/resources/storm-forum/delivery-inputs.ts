import { ApiObject, JsonPatch, type Chart } from "cdk8s";
import { z } from "zod";
import type { ForumRelease } from "./release-schema.ts";

const ContainerSchema = z.object({
  image: z.string().optional(),
  env: z
    .array(z.object({ name: z.string(), value: z.string().optional() }))
    .optional(),
});
const ConsumerSchema = z.object({
  spec: z.object({
    template: z.object({
      spec: z.object({
        initContainers: z.array(ContainerSchema).optional(),
        containers: z.array(ContainerSchema),
      }),
    }),
  }),
});

function selected(key: string, legacy: string): string {
  // An explicitly delegated release may never inherit a baked-in legacy pin.
  return `{{ if .Values.delivery.enabled }}{{ required \`Delivery requires ${key}\` .Values.delivery.${key} }}{{ else }}${legacy}{{ end }}`;
}

const PARAMETERS = new Map([
  ["BUNDLE_KEY", "bundleKey"],
  ["BUNDLE_SHA256", "bundleSha256"],
  ["RUNTIME_IMAGE", "image"],
  ["BACKUP_SOURCE_BUNDLE_SHA256", "previousBundleSha256"],
  ["BACKUP_SOURCE_XENFORO_VERSION", "previousXenforoVersion"],
  ["BACKUP_SOURCE_RUNTIME_IMAGE", "previousRuntimeImage"],
]);

function parameterizeContainer(
  resource: ApiObject,
  base: string,
  container: z.infer<typeof ContainerSchema>,
  release: ForumRelease,
): void {
  if (container.image === release.image) {
    resource.addJsonPatch(
      JsonPatch.replace(`${base}/image`, selected("image", release.image)),
    );
  }
  for (const [index, env] of (container.env ?? []).entries()) {
    const key = PARAMETERS.get(env.name);
    if (key !== undefined && env.value !== undefined) {
      resource.addJsonPatch(
        JsonPatch.replace(
          `${base}/env/${index.toString()}/value`,
          selected(key, env.value),
        ),
      );
    }
  }
}

/** Prepare reviewed release inputs without transferring ownership or changing defaults. */
export function parameterizeForumDelivery(
  chart: Chart,
  release: ForumRelease,
): void {
  if (release.restore || !release.preUpgradeBackup) return;
  for (const resource of chart.node.findAll()) {
    if (
      !ApiObject.isApiObject(resource) ||
      !["Deployment", "Job"].includes(resource.kind)
    )
      continue;
    const pod = ConsumerSchema.parse(resource.toJson()).spec.template.spec;
    for (const group of ["initContainers", "containers"] as const) {
      for (const [index, container] of (pod[group] ?? []).entries()) {
        const base = `/spec/template/spec/${group}/${index.toString()}`;
        parameterizeContainer(resource, base, container, release);
      }
    }
    if (resource.kind === "Job") {
      resource.addJsonPatch(
        JsonPatch.replace(
          "/metadata/name",
          `storm-forum-release-${selected("releaseId", release.releaseId)}`,
        ),
      );
    }
  }
}
