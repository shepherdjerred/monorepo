import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createTemporalChart } from "./cdk8s-charts/temporal.ts";
import { ContainerEnvSchema } from "./testing/container-env-schema.ts";

const TemporalResourceSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
    data: z.record(z.string(), z.string()).optional(),
    spec: z.unknown().optional(),
  })
  .loose();

export type TemporalResource = z.infer<typeof TemporalResourceSchema>;

const TemporalWorkerPodSchema = z.object({
  metadata: z.object({ labels: z.record(z.string(), z.string()) }),
  spec: z.object({
    automountServiceAccountToken: z.literal(false),
    containers: z.array(z.object({ env: ContainerEnvSchema })),
  }),
});
const TemporalWorkerDeploymentSchema = z.object({
  template: TemporalWorkerPodSchema,
});

export type TemporalWorkerContainer = z.infer<
  typeof TemporalWorkerPodSchema
>["spec"]["containers"][number];

export function synthesizeTemporalResources(
  outdir: string,
): TemporalResource[] {
  const app = new App({ outdir });
  createTemporalChart(app);
  return parseAllDocuments(app.synthYaml()).flatMap((document) => {
    const resource = TemporalResourceSchema.safeParse(document.toJSON());
    return resource.success ? [resource.data] : [];
  });
}

export function findTemporalResource(
  synthesized: readonly TemporalResource[],
  kind: string,
  name: string,
): TemporalResource {
  const resource = synthesized.find(
    (candidate) => candidate.kind === kind && candidate.metadata.name === name,
  );
  if (resource === undefined) {
    throw new Error(`Missing ${kind}/${name}`);
  }
  return resource;
}

export function findTemporalWorkerContainer(
  synthesized: readonly TemporalResource[],
  name: string,
): {
  pod: z.infer<typeof TemporalWorkerPodSchema>;
  container: TemporalWorkerContainer;
} {
  const deployment = findTemporalResource(synthesized, "Deployment", name);
  const pod = TemporalWorkerDeploymentSchema.parse(deployment.spec).template;
  const container = pod.spec.containers[0];
  if (container === undefined) {
    throw new Error(`Missing container in ${name}`);
  }
  return { pod, container };
}
