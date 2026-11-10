/**
 * Reads the committed cdktn synthesis of a stack (`main.tf.json`).
 *
 * Repository checks that used to pattern-match HCL (tunnel DNS coverage, the
 * SeaweedFS backup bucket list, the 1Password vault audit) call this for a
 * ported stack and keep their HCL reader for one that is not. It is a bridge:
 * once the shared platform model exists those checks read the model instead.
 */
import path from "node:path";
import { z } from "zod";

const BlockSchema = z.record(z.string(), z.unknown());
const SynthesizedConfigurationSchema = z.looseObject({
  resource: z.record(z.string(), z.record(z.string(), BlockSchema)).optional(),
  module: z.record(z.string(), BlockSchema).optional(),
  locals: BlockSchema.optional(),
});

export type SynthesizedConfiguration = z.infer<
  typeof SynthesizedConfigurationSchema
>;

export type SynthesizedResource = {
  type: string;
  name: string;
  attributes: Readonly<Record<string, unknown>>;
};

export function parseSynthesizedConfiguration(
  content: string,
): SynthesizedConfiguration {
  return SynthesizedConfigurationSchema.parse(JSON.parse(content));
}

/** The stack's synthesis, or `undefined` while the stack is hand-written HCL. */
export async function readSynthesizedConfiguration(
  stackDirectory: string,
): Promise<SynthesizedConfiguration | undefined> {
  const file = Bun.file(path.join(stackDirectory, "main.tf.json"));
  return (await file.exists())
    ? parseSynthesizedConfiguration(await file.text())
    : undefined;
}

/** Every resource of one type, or of all types, in declaration order. */
export function synthesizedResources(
  configuration: SynthesizedConfiguration,
  type?: string,
): SynthesizedResource[] {
  return Object.entries(configuration.resource ?? {})
    .filter(([candidate]) => type === undefined || candidate === type)
    .flatMap(([resourceType, byName]) =>
      Object.entries(byName).map(([name, attributes]) => ({
        type: resourceType,
        name,
        attributes,
      })),
    );
}

/** A string attribute holding no expression; `undefined` for anything computed. */
export function literalAttribute(
  attributes: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined {
  const value = attributes[name];
  return typeof value === "string" && !value.includes("${") ? value : undefined;
}

/**
 * The resource a `"${<type>.<name>.<attribute>}"` reference points at:
 * `referencedResource("${cloudflare_zone.sjer_red.id}", "cloudflare_zone")`
 * is `sjer_red`.
 */
export function referencedResource(
  value: unknown,
  type: string,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^\$\{(?<type>[\w-]+)\.(?<name>[\w-]+)\.[\w-]+\}$/u.exec(value);
  return match?.groups?.["type"] === type ? match.groups["name"] : undefined;
}
