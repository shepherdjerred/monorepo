import { App } from "cdk8s";
import { z } from "zod";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";

export const SynthesizedObjectSchema = z.looseObject({
  apiVersion: z.string(),
  kind: z.string(),
  metadata: z.looseObject({
    name: z.string(),
    namespace: z.string().optional(),
  }),
  spec: z.unknown().optional(),
});
export type SynthesizedObject = z.infer<typeof SynthesizedObjectSchema>;

/** `apiVersion/kind/namespace/name`: what the API server identifies an object by. */
export function objectIdentity(object: SynthesizedObject): string {
  return `${object.apiVersion}/${object.kind}/${object.metadata.namespace ?? ""}/${object.metadata.name}`;
}

/**
 * Every chart's objects as synthesis publishes them. Synthesis completes
 * lazily built specs (cdk8s-plus workloads, patched limits), so the charts
 * are read after it. Mock `transitionRendering` in the calling test file to
 * render the cutover state.
 */
export async function synthesizedCharts(): Promise<
  ReadonlyMap<string, SynthesizedObject[]>
> {
  const app = new App();
  await setupCharts(app);
  app.synthYaml();
  return new Map(
    app.charts.map((chart) => [
      chart.node.id,
      z.array(SynthesizedObjectSchema).parse(chart.toJson()),
    ]),
  );
}

export function chartObjectsOf(
  charts: ReadonlyMap<string, SynthesizedObject[]>,
  id: string,
): SynthesizedObject[] {
  const objects = charts.get(id);
  if (objects === undefined) throw new Error(`Chart ${id} was not rendered`);
  return objects;
}
