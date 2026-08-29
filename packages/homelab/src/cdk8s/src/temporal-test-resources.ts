import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createTemporalChart } from "./cdk8s-charts/temporal.ts";

const TemporalResourceSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
    data: z.record(z.string(), z.string()).optional(),
    spec: z.unknown().optional(),
  })
  .loose();

export type TemporalResource = z.infer<typeof TemporalResourceSchema>;

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
