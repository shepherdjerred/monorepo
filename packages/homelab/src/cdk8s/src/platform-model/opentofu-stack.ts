import path from "node:path";
import { z } from "zod";

/**
 * One OpenTofu stack as `opentofu-side.ts` reads it: its committed
 * `main.tf.json`, synthesized by the CDK Terrain app.
 */
export const TOFU_ROOT = path.resolve(import.meta.dirname, "../../../tofu");

export type Resource = {
  stack: string;
  type: string;
  name: string;
  /** Attribute name to its JSON-encoded value. */
  attributes: ReadonlyMap<string, string>;
};

export type ModuleCall = {
  name: string;
  /** The call's arguments as synthesized: literals, or `"${...}"` strings. */
  arguments: Readonly<Record<string, unknown>>;
};

export type Stack = {
  name: string;
  resources: readonly Resource[];
  locals: Readonly<Record<string, unknown>>;
  modules: readonly ModuleCall[];
  /** The synthesized JSON, for name scans. */
  text: string;
  backendEndpoint: string | undefined;
};

const SynthesizedStackSchema = z.looseObject({
  locals: z.record(z.string(), z.unknown()).optional(),
  module: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  resource: z
    .record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown())))
    .optional(),
  terraform: z.looseObject({
    backend: z
      .looseObject({
        s3: z
          .looseObject({ endpoints: z.looseObject({ s3: z.string() }) })
          .optional(),
      })
      .optional(),
  }),
});

/**
 * The value of a JSON-encoded attribute when it is a plain string without
 * interpolation, else `undefined`.
 */
export function literalString(encoded: string | undefined): string | undefined {
  if (encoded === undefined) return undefined;
  const value: unknown = JSON.parse(encoded);
  return typeof value === "string" && !/[$%]\{/.test(value) ? value : undefined;
}

/** An attribute's literal string. */
export function text(
  resource: Resource,
  attribute: string,
): string | undefined {
  return literalString(resource.attributes.get(attribute));
}

export async function readStack(name: string): Promise<Stack> {
  const source = await Bun.file(
    path.join(TOFU_ROOT, name, "main.tf.json"),
  ).text();
  const stack = SynthesizedStackSchema.parse(JSON.parse(source));
  return {
    name,
    resources: Object.entries(stack.resource ?? {}).flatMap(([type, byName]) =>
      Object.entries(byName).map(([resourceName, attributes]) => ({
        stack: name,
        type,
        name: resourceName,
        attributes: new Map(
          Object.entries(attributes).map(([key, value]) => [
            key,
            JSON.stringify(value),
          ]),
        ),
      })),
    ),
    locals: stack.locals ?? {},
    modules: Object.entries(stack.module ?? {}).map(
      ([moduleName, moduleArguments]) => ({
        name: moduleName,
        arguments: moduleArguments,
      }),
    ),
    text: source,
    backendEndpoint: stack.terraform.backend?.s3?.endpoints.s3,
  };
}

export async function stackNames(): Promise<string[]> {
  const names: string[] = [];
  for await (const file of new Bun.Glob("*/main.tf.json").scan({
    cwd: TOFU_ROOT,
  }))
    names.push(file.split("/")[0] ?? "");
  return names.toSorted();
}
