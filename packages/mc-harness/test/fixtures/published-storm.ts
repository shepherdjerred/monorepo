import snapshots from "#sandbox/storm-image-configs.json";
import { SandboxCreateRequestSchema } from "#protocol/ipc.ts";

/** Explicit original metadata; the future digest deliberately has no historical snapshot. */
export function publishedStorm(
  profile: "storm-prod" | "storm-candidate" = "storm-prod",
) {
  const historical = Object.values(snapshots)[0];
  if (historical === undefined)
    throw new Error("Historical immutable module fixture missing");
  const yaml = [
    "modules:",
    ...historical.moduleKeys.map((key) => `  ${key}: false`),
    "",
  ].join("\n");
  const input = SandboxCreateRequestSchema.parse({
    profile,
    world: "flat",
    ttlSeconds: 120,
    keep: false,
    publishedArtifact: {
      id: "minecraft/original-image",
      buildId: "minecraft/original-build",
      serviceId: "minecraft",
      sourceRevision: "b".repeat(40),
      component: "image:the-storm-server",
      kind: "image",
      uri: "docker.io/shepherdjerred/the-storm-server",
      digest: `sha256:${"c".repeat(64)}`,
      runtimeDigests: [`sha256:${"d".repeat(64)}`],
      version: "2.0.0-123",
      createdAt: "2026-10-18T00:00:00.000Z",
      origin: { kind: "first-party" },
    },
    publishedConfig: {
      sourceRevision: "b".repeat(40),
      sha256: new Bun.CryptoHasher("sha256").update(yaml).digest("hex"),
      yaml,
    },
  });
  if (
    input.publishedArtifact === undefined ||
    input.publishedConfig === undefined
  )
    throw new Error("Published fixture lost its frozen original inputs");
  return {
    ...input,
    publishedArtifact: input.publishedArtifact,
    publishedConfig: input.publishedConfig,
  };
}
