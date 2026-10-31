import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";

const Manifest = z.object({
  kind: z.string(),
  metadata: z.object({
    name: z.string(),
    namespace: z.string().optional(),
    annotations: z.record(z.string(), z.string()),
  }),
  spec: z.record(z.string(), z.unknown()),
});
export type PolicyManifest = z.infer<typeof Manifest>;

/** Synthesizes admission policies into a fresh chart and parses each manifest. */
export function renderAdmissionPolicies(
  create: (chart: Chart) => void,
): PolicyManifest[] {
  const app = new App();
  create(new Chart(app, "policies"));
  return parseAllDocuments(app.synthYaml()).map((doc) =>
    Manifest.parse(doc.toJS()),
  );
}
