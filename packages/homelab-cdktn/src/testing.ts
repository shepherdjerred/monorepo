import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { App, TerraformStack } from "cdktn";
import { z } from "zod";
import { synthesize, withoutGeneratorMetadata } from "#scripts/synth.ts";
import type { SynthesizedStack } from "#src/app.ts";

/** `resource.<type>.<name>` and its arguments, as a synthesized stack writes them. */
export const ResourcesSchema = z.record(
  z.string(),
  z.record(z.string(), z.record(z.string(), z.unknown())),
);

/** `provider.<name>`: one block per alias, as a synthesized stack writes them. */
export const ProviderBlocksSchema = z.record(
  z.string(),
  z.array(z.record(z.string(), z.unknown())),
);

/** `variable.<name>` and its arguments. */
export const VariablesSchema = z.record(
  z.string(),
  z.record(z.string(), z.unknown()),
);

/** The `terraform` block of a synthesized stack: provider pins and encryption. */
export const TerraformSchema = z.looseObject({
  encryption: z.unknown(),
  required_providers: z.record(
    z.string(),
    z.object({ source: z.string(), version: z.string() }),
  ),
});

/** {@link TerraformSchema} for a stack that also pins the OpenTofu version. */
export const VersionedTerraformSchema = TerraformSchema.extend({
  required_version: z.string(),
});

/** The committed app's configuration for one stack, parsed by the test's schema. */
export async function synthesizedStack<Schema extends z.ZodType>(
  stack: SynthesizedStack,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const synthesized = await synthesize();
  return schema.parse(JSON.parse(synthesized.get(stack) ?? ""));
}

/**
 * The enforced state and plan `encryption` block a stack must synthesize,
 * written out independently of `encryptStateAndPlans`. The defaults are the
 * names the HCL stacks used; a stack whose encrypted state records other
 * names passes its own.
 */
export function enforcedEncryption({
  variable = "tofu_state_encryption_passphrase",
  keyProvider = "state",
  method = "encrypted",
}: { variable?: string; keyProvider?: string; method?: string } = {}) {
  return {
    key_provider: {
      pbkdf2: { [keyProvider]: { passphrase: `\${var.${variable}}` } },
    },
    method: {
      aes_gcm: {
        [method]: { keys: `\${key_provider.pbkdf2.${keyProvider}}` },
      },
    },
    state: { method: `method.aes_gcm.${method}`, enforced: true },
    plan: { method: `method.aes_gcm.${method}`, enforced: true },
  };
}

const SynthesizedSchema = z.looseObject({
  resource: ResourcesSchema.optional(),
  data: ResourcesSchema.optional(),
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
