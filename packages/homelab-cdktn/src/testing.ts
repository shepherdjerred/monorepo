import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { App, TerraformStack } from "cdktn";
import { z } from "zod";
import { withoutGeneratorMetadata } from "#scripts/synth.ts";

const SynthesizedSchema = z.looseObject({
  resource: z
    .record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown())))
    .optional(),
  import: z.array(z.record(z.string(), z.unknown())).optional(),
  moved: z.array(z.record(z.string(), z.unknown())).optional(),
  removed: z.array(z.record(z.string(), z.unknown())).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Synthesizes a throwaway stack the way the real app does (same logical-id
 * context, generator metadata dropped) and returns its configuration, so a
 * helper is proven on the JSON OpenTofu would read without porting a stack.
 */
export async function synthesizeStack(
  build: (stack: TerraformStack) => void,
): Promise<z.infer<typeof SynthesizedSchema>> {
  const outdir = await mkdtemp(path.join(tmpdir(), "cdktn-helper-"));
  try {
    const app = new App({
      outdir,
      context: {
        excludeStackIdFromLogicalIds: "true",
        allowSepCharsInLogicalIds: "true",
      },
    });
    build(new TerraformStack(app, "fixture"));
    app.synth();
    const raw: unknown = await Bun.file(
      path.join(outdir, "stacks/fixture/cdk.tf.json"),
    ).json();
    return SynthesizedSchema.parse(withoutGeneratorMetadata(raw));
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}
