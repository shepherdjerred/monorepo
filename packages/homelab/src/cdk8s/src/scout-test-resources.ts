import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createScoutChart } from "./cdk8s-charts/scout.ts";
import { createTemporalChart } from "./cdk8s-charts/platform/temporal.ts";
import type { ScoutGatewayTopology } from "./resources/scout/topology.ts";

export const ScoutTestResourceSchema = z
  .object({
    kind: z.string(),
    metadata: z
      .object({ name: z.string(), namespace: z.string().optional() })
      .loose(),
    spec: z.unknown().optional(),
  })
  .loose();

type ScoutTestResource = z.infer<typeof ScoutTestResourceSchema>;

export function resourcesFor(app: App): ScoutTestResource[] {
  return parseAllDocuments(app.synthYaml()).flatMap((document) => {
    const resource = ScoutTestResourceSchema.safeParse(document.toJSON());
    return resource.success ? [resource.data] : [];
  });
}

export function findResource(
  resources: ScoutTestResource[],
  kind: string,
  name: string,
): ScoutTestResource {
  const resource = resources.find(
    (candidate) => candidate.kind === kind && candidate.metadata.name === name,
  );
  if (resource === undefined) {
    throw new Error(`Missing ${kind}/${name}`);
  }
  return resource;
}

export function scoutResources(stage: "beta" | "prod"): ScoutTestResource[] {
  const app = new App();
  createScoutChart(app, stage);
  return resourcesFor(app);
}

/**
 * Render a stage as though its SCOUT_GATEWAY_TOPOLOGY entry said `topology`.
 *
 * The retirement path is the rollback the whole `retiring` state exists for, so
 * it is proven by rendering the real chart through the real code rather than by
 * mocking the module that decides the topology — a mocked decision would only
 * prove the mock.
 */
export function scoutResourcesWithGatewayTopology(
  stage: "beta" | "prod",
  topology: ScoutGatewayTopology,
): ScoutTestResource[] {
  const app = new App();
  createScoutChart(app, stage, undefined, topology);
  return resourcesFor(app);
}

export function temporalResources(): ScoutTestResource[] {
  const app = new App();
  createTemporalChart(app);
  return resourcesFor(app);
}

export function allScoutTemporalResources(): ScoutTestResource[] {
  const app = new App({ outdir: ".test-synth-scout-temporal" });
  createTemporalChart(app);
  createScoutChart(app, "beta");
  createScoutChart(app, "prod");
  return resourcesFor(app);
}
