import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { App, Chart, Testing } from "cdk8s";
import { expect, test } from "vitest";
import { parseAllDocuments, stringify } from "yaml";
import { z } from "zod";
import { createArcadeDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/arcade.ts";
import { resetProbeRegistry } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/probe-registry.ts";

test("the reviewed Arcade image binding renders the selected digest into its actual Helm deployment", async () => {
  const input: unknown = await Bun.file(
    new URL(
      "../../../../../../delivery/registrations/arcade.pipeline.json",
      import.meta.url,
    ),
  ).json();
  const pipeline = z
    .object({
      chartName: z.string(),
      namespace: z.string(),
      artifactParameters: z.record(z.string(), z.string()),
    })
    .parse(input);
  const selectedImage = `docker.io/shepherdjerred/arcade@sha256:${"a".repeat(64)}`;
  const bindings = Object.entries(pipeline.artifactParameters);
  expect(bindings).toEqual([["delivery.image", "image:arcade"]]);
  const binding = bindings[0];
  if (binding === undefined) throw new Error("Arcade image binding is missing");
  const directory = await mkdtemp(path.join(tmpdir(), "arcade-delivery-helm-"));
  try {
    resetProbeRegistry();
    const chart = new Chart(new App(), pipeline.chartName, {
      namespace: pipeline.namespace,
      disableResourceNameHashes: true,
    });
    createArcadeDeployment(chart);
    await mkdir(path.join(directory, "templates"));
    await Bun.write(
      path.join(directory, "Chart.yaml"),
      `apiVersion: v2\nname: ${pipeline.chartName}\nversion: 1.0.0\n`,
    );
    await Bun.write(
      path.join(directory, "templates/arcade.yaml"),
      Testing.synth(chart)
        .map((resource) => stringify(resource))
        .join("---\n"),
    );
    const child = Bun.spawn(
      [
        "helm",
        "template",
        "arcade",
        directory,
        "--set-string",
        `${binding[0]}=${selectedImage}`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    const DeploymentSchema = z.object({
      kind: z.literal("Deployment"),
      metadata: z.object({ name: z.literal("arcade") }),
      spec: z.object({
        template: z.object({
          spec: z.object({
            containers: z.array(z.object({ image: z.string() })),
          }),
        }),
      }),
    });
    const deployments = parseAllDocuments(stdout)
      .map((document) => {
        const resource: unknown = document.toJSON();
        return DeploymentSchema.safeParse(resource);
      })
      .filter((result) => result.success);
    expect(deployments).toHaveLength(1);
    expect(
      deployments[0]?.data?.spec.template.spec.containers.map(
        (container) => container.image,
      ),
    ).toEqual([selectedImage]);
  } finally {
    await rm(directory, { recursive: true });
  }
});
