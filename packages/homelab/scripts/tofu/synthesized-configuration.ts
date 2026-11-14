/**
 * Reads the committed cdktn synthesis of a stack (`main.tf.json`).
 *
 * Repository checks that need what a stack declares (tunnel DNS coverage, the
 * SeaweedFS backup bucket list, the 1Password vault audit) read it here. It
 * is a bridge: once the shared platform model exists those checks read the
 * model instead.
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

/** The stack's synthesis; a stack directory without one is a broken contract. */
export async function readSynthesizedConfiguration(
  stackDirectory: string,
): Promise<SynthesizedConfiguration> {
  const file = Bun.file(path.join(stackDirectory, "main.tf.json"));
  if (!(await file.exists()))
    throw new Error(
      `${stackDirectory} has no main.tf.json: packages/homelab-cdktn synthesizes every stack`,
    );
  return parseSynthesizedConfiguration(await file.text());
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
