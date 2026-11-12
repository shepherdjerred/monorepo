import { Testing, type Chart } from "cdk8s";
import { z } from "zod";

const Manifest = z.looseObject({
  kind: z.string(),
  metadata: z.looseObject({ name: z.string() }),
});

/**
 * Synthesizes a chart for a construct test: its manifests in rendered order,
 * their `Kind/name` identities, and a lookup by kind.
 */
export function synthManifests(chart: Chart) {
  const manifests = z.array(Manifest).parse(Testing.synth(chart));
  return {
    manifests,
    identities: manifests.map(
      (manifest) => `${manifest.kind}/${manifest.metadata.name}`,
    ),
    of: (kind: string) =>
      manifests.filter((manifest) => manifest.kind === kind),
  };
}
