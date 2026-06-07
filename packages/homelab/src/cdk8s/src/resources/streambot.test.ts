import { describe, expect, it } from "bun:test";
import { App } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createMediaChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/media.ts";

// streambot is the from-scratch rewrite (packages/streambot), deployed in the `media` namespace so
// it can read-only mount the movies/tv libraries. This guards that wiring: first-party ghcr image,
// non-root, read-only library mounts, and NO leftover writable yt-dlp `scripts` dir (the old
// upstream-image bug — yt-dlp/ffmpeg are now baked into the first-party image).
const STREAMBOT_MOVIES = "/media/movies";
const STREAMBOT_TV = "/media/tv";
const LEGACY_SCRIPTS_PATH = "/home/bots/StreamBot/scripts";

const VolumeMountSchema = z
  .object({
    name: z.string(),
    mountPath: z.string(),
    readOnly: z.boolean().optional(),
  })
  .loose();

const ContainerSchema = z
  .object({
    image: z.string().optional(),
    volumeMounts: z.array(VolumeMountSchema).optional(),
    securityContext: z
      .object({ runAsUser: z.number().optional() })
      .loose()
      .optional(),
  })
  .loose();

const DeploymentSchema = z
  .object({
    kind: z.literal("Deployment"),
    metadata: z.object({ name: z.string().optional() }).loose().optional(),
    spec: z
      .object({
        template: z
          .object({
            spec: z.object({ containers: z.array(ContainerSchema) }).loose(),
          })
          .loose(),
      })
      .loose(),
  })
  .loose();

function parseSynthesizedDocuments(yamlContent: string): unknown[] {
  return yamlContent
    .split(/^---$/m)
    .map((doc) => doc.trim())
    .filter((doc) => doc.length > 0)
    .map((document): unknown => parseYaml(document));
}

function getStreambotDeployment(): z.infer<typeof DeploymentSchema> {
  const app = new App({ outdir: ".test-synth-streambot-media" });
  createMediaChart(app);
  for (const document of parseSynthesizedDocuments(app.synthYaml())) {
    const result = DeploymentSchema.safeParse(document);
    if (result.success && result.data.metadata?.name === "media-streambot") {
      return result.data;
    }
  }
  throw new Error(
    "streambot Deployment was not synthesized into the media chart",
  );
}

describe("streambot deployment (media namespace)", () => {
  const deployment = getStreambotDeployment();
  const container = deployment.spec.template.spec.containers[0];

  it("uses the first-party ghcr image", () => {
    expect(container?.image).toStartWith("ghcr.io/shepherdjerred/streambot:");
  });

  it("runs as the non-root user", () => {
    expect(container?.securityContext?.runAsUser).toBe(1000);
  });

  it("mounts the movies and tv libraries read-only", () => {
    const mounts = container?.volumeMounts ?? [];
    const movies = mounts.find((mount) => mount.mountPath === STREAMBOT_MOVIES);
    const tv = mounts.find((mount) => mount.mountPath === STREAMBOT_TV);
    expect(movies?.readOnly).toBe(true);
    expect(tv?.readOnly).toBe(true);
  });

  it("does not carry the legacy writable yt-dlp scripts mount", () => {
    const mounts = container?.volumeMounts ?? [];
    expect(
      mounts.some((mount) => mount.mountPath === LEGACY_SCRIPTS_PATH),
    ).toBe(false);
  });
});
