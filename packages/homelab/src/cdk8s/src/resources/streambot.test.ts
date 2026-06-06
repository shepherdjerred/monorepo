import { describe, expect, it } from "bun:test";
import { App } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createStreambotChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/streambot.ts";

// yt-dlp is downloaded and self-updated by StreamBot into `${cwd}/scripts` at
// runtime. The container runs as a non-root user (UID 1000) on top of a
// root-owned image WORKDIR, so that path MUST be backed by a writable volume —
// otherwise the download fails with EACCES and every YouTube/URL play breaks
// with `spawn .../scripts/yt-dlp ENOENT`. This smoke test guards that wiring.
const YTDLP_SCRIPTS_PATH = "/home/bots/StreamBot/scripts";

const VolumeMountSchema = z
  .object({ name: z.string(), mountPath: z.string() })
  .loose();

const VolumeSchema = z
  .object({ name: z.string(), emptyDir: z.unknown().optional() })
  .loose();

const ContainerSchema = z
  .object({
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
            spec: z
              .object({
                containers: z.array(ContainerSchema),
                volumes: z.array(VolumeSchema).optional(),
              })
              .loose(),
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
  const app = new App({ outdir: ".test-synth-streambot" });
  createStreambotChart(app);

  for (const document of parseSynthesizedDocuments(app.synthYaml())) {
    const result = DeploymentSchema.safeParse(document);
    if (result.success && result.data.metadata?.name === "streambot") {
      return result.data;
    }
  }

  throw new Error("streambot Deployment was not synthesized");
}

describe("streambot deployment", () => {
  const deployment = getStreambotDeployment();
  const podSpec = deployment.spec.template.spec;
  const container = podSpec.containers[0];

  it("runs as the non-root user that makes a writable yt-dlp dir necessary", () => {
    // If this ever changes to root, the writable-mount requirement below is moot,
    // and this test should be revisited rather than silently passing.
    expect(container?.securityContext?.runAsUser).toBe(1000);
  });

  it("mounts a writable volume at the yt-dlp scripts path", () => {
    const scriptsMount = (container?.volumeMounts ?? []).find(
      (mount) => mount.mountPath === YTDLP_SCRIPTS_PATH,
    );

    expect(scriptsMount).toBeDefined();

    // The referenced volume must exist and be writable scratch (emptyDir),
    // not a read-only source like a ConfigMap/Secret projection.
    const backingVolume = (podSpec.volumes ?? []).find(
      (volume) => volume.name === scriptsMount?.name,
    );

    expect(backingVolume).toBeDefined();
    expect(backingVolume?.emptyDir).toBeDefined();
  });
});
