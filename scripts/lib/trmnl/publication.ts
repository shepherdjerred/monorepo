import path from "node:path";
import { lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  ArtifactInputSchema,
  ArtifactVersionSchema,
} from "@shepherdjerred/delivery/contract";
import {
  TRMNL_PLUGIN_POLICY,
  serializeTrmnlPluginBundle,
  validateTrmnlPluginSettings,
} from "@shepherdjerred/ops-model/trmnl/plugin-policy.ts";

/**
 * Package the reviewed plugin sources as a v2 bundle. The bundle carries no
 * source revision: its bytes depend only on content, so an unchanged rebuild
 * on a later commit reproduces the same digest and Delivery retains the
 * existing archive instead of registering a duplicate.
 */
export async function buildTrmnlPluginArchive(root: string) {
  const plugins = await Promise.all(
    TRMNL_PLUGIN_POLICY.plugins.map(async (target) => {
      const entries = await Promise.all(
        TRMNL_PLUGIN_POLICY.files.map(async (name) => {
          const file = path.join(root, target.slug, "src", name);
          const stat = await lstat(file);
          if (!stat.isFile() || stat.size > 512 * 1024)
            throw new Error("TRMNL source must be a bounded regular file");
          return [
            name,
            new TextDecoder("utf-8", { fatal: true }).decode(
              await Bun.file(file).bytes(),
            ),
          ] as const;
        }),
      );
      return { ...target, files: Object.fromEntries(entries) };
    }),
  );
  const bundle = {
    schema: "delivery-trmnl-plugins/v2" as const,
    plugins,
  };
  validateTrmnlPluginSettings(bundle, parseYaml);
  const bytes = serializeTrmnlPluginBundle(bundle);
  const hex = createHash("sha256").update(bytes).digest("hex");
  return {
    bytes,
    digest: `sha256:${hex}`,
    uri: `s3://delivery-artifacts/trmnl-plugins/${hex}.json`,
  };
}

/** Preserve the exact backend dependency and its original artifact identity. */
export async function trmnlBackendDigest(
  digests: unknown,
  latest: () => Promise<unknown>,
): Promise<string> {
  const fresh = z
    .record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/u))
    .parse(digests)["shepherdjerred/trmnl-dashboard"];
  if (fresh !== undefined) return fresh;
  const artifact = ArtifactVersionSchema.parse(await latest());
  if (
    artifact.serviceId !== "trmnl-dashboard" ||
    artifact.component !== "image:trmnl-dashboard" ||
    artifact.kind !== "image" ||
    artifact.uri !== "docker.io/shepherdjerred/trmnl-dashboard"
  )
    throw new Error("Qualified TRMNL backend differs from its canonical owner");
  return artifact.digest;
}

export function trmnlArchiveArtifact(
  archive: { uri: string; digest: string },
  backend: string,
  build: { repositoryId: string; pipelineNumber: string },
) {
  return ArtifactInputSchema.parse({
    id: `ci/${build.repositoryId}/${build.pipelineNumber}/trmnl-plugins`,
    component: "archive:trmnl-plugins",
    kind: "archive",
    uri: archive.uri,
    digest: archive.digest,
    requires: { "image:trmnl-dashboard": backend },
    version: `build-${build.pipelineNumber}`,
  });
}
