import { z } from "zod";
import source from "./plugin-policy.json" with { type: "json" };

export const TRMNL_PLUGIN_POLICY = z
  .object({
    schemaVersion: z.literal(1),
    plugins: z
      .array(
        z
          .object({
            slug: z.string().regex(/^[a-z][a-z-]+$/u),
            id: z.number().int().positive(),
          })
          .strict(),
      )
      .length(3),
    files: z
      .array(z.string().regex(/^(?:settings\.yml|[a-z_]+\.liquid)$/u))
      .length(6),
  })
  .strict()
  .refine(
    (policy) =>
      new Set(policy.plugins.map((plugin) => plugin.slug)).size === 3 &&
      new Set(policy.plugins.map((plugin) => plugin.id)).size === 3 &&
      new Set(policy.files).size === 6,
    "Plugin targets and source basenames must be unique",
  )
  .parse(source);
export const MAX_TRMNL_PLUGIN_BYTES = 2 * 1024 * 1024;
const TrmnlPluginsSchema = z
  .array(
    z
      .object({
        slug: z.string(),
        id: z.number().int().positive(),
        files: z.record(z.string(), z.string().max(512 * 1024)),
      })
      .strict(),
  )
  .length(3);
export const TrmnlPluginBundleSchema = z
  .discriminatedUnion("schema", [
    z
      .object({
        schema: z.literal("delivery-trmnl-plugins/v1"),
        sourceRevision: z.string().regex(/^[a-f0-9]{40}$/u),
        plugins: TrmnlPluginsSchema,
      })
      .strict(),
    // v2 carries no producer revision: the bundle's identity is its content,
    // so an unchanged bundle is retained across commits instead of republished.
    z
      .object({
        schema: z.literal("delivery-trmnl-plugins/v2"),
        plugins: TrmnlPluginsSchema,
      })
      .strict(),
  ])
  .superRefine((bundle, context) => {
    const targets = new Set<string>();
    for (const plugin of bundle.plugins) {
      const expected = TRMNL_PLUGIN_POLICY.plugins.find(
        (target) => target.slug === plugin.slug,
      );
      if (expected?.id !== plugin.id || targets.has(plugin.slug))
        context.addIssue({
          code: "custom",
          message:
            "Plugin target differs from the reviewed fixed target inventory",
        });
      targets.add(plugin.slug);
      const names = Object.keys(plugin.files);
      if (
        names.length !== TRMNL_PLUGIN_POLICY.files.length ||
        names.some((name) => !TRMNL_PLUGIN_POLICY.files.includes(name))
      )
        context.addIssue({
          code: "custom",
          message:
            "Plugin package must contain exactly the reviewed six source files",
        });
    }
  });
export type TrmnlPluginBundle = z.infer<typeof TrmnlPluginBundleSchema>;
export function parseTrmnlPluginBundle(
  bytes: Uint8Array | string,
): TrmnlPluginBundle {
  const encoded =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  if (encoded.byteLength > MAX_TRMNL_PLUGIN_BYTES)
    throw new Error("TRMNL plugin bundle exceeds 2MiB");
  return TrmnlPluginBundleSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encoded)),
  );
}
/** Both native producer and executor supply their existing safe YAML parser; data and target policy stay neutral. */
export function validateTrmnlPluginSettings(
  bundle: TrmnlPluginBundle,
  parseSettings: (text: string) => unknown,
): void {
  for (const plugin of bundle.plugins) {
    const settings = plugin.files["settings.yml"];
    if (
      settings === undefined ||
      !z.object({ id: z.literal(plugin.id) }).safeParse(parseSettings(settings))
        .success
    )
      throw new Error(
        "TRMNL settings ID differs from its reviewed plugin target",
      );
  }
}
export function serializeTrmnlPluginBundle(input: TrmnlPluginBundle): string {
  const parsed = TrmnlPluginBundleSchema.parse(input);
  // Key order is part of the bytes, so v1 keeps its digest-stable layout.
  const canonical = {
    schema: parsed.schema,
    ...(parsed.schema === "delivery-trmnl-plugins/v1"
      ? { sourceRevision: parsed.sourceRevision }
      : {}),
    plugins: TRMNL_PLUGIN_POLICY.plugins.map((target) => {
      const plugin = parsed.plugins.find((entry) => entry.slug === target.slug);
      if (plugin === undefined)
        throw new Error("Required TRMNL plugin missing");
      return {
        ...target,
        files: Object.fromEntries(
          TRMNL_PLUGIN_POLICY.files.map((name) => [name, plugin.files[name]]),
        ),
      };
    }),
  };
  const bytes = JSON.stringify(canonical) + "\n";
  parseTrmnlPluginBundle(bytes);
  return bytes;
}
