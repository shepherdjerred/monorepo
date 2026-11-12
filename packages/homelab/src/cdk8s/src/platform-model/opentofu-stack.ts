import path from "node:path";
import { z } from "zod";
import {
  literalString,
  objectEntries,
  parseHcl,
  type HclBlock,
} from "./hcl.ts";

/**
 * One OpenTofu stack as `opentofu-side.ts` reads it: its committed
 * `main.tf.json` when the CDK Terrain app has ported it, otherwise its `.tf`
 * files.
 */
export const TOFU_ROOT = path.resolve(import.meta.dirname, "../../../tofu");

export type Resource = {
  stack: string;
  type: string;
  name: string;
  /** Attribute text: an HCL expression, or the JSON-encoded value. */
  attributes: ReadonlyMap<string, string>;
};

export type ModuleCall = {
  name: string;
  /** The call's arguments as synthesized: literals, or `"${...}"` strings. */
  arguments: Readonly<Record<string, unknown>>;
};

export type Stack = {
  name: string;
  /** `.tf` blocks of the root module; empty for a synthesized stack. */
  blocks: readonly HclBlock[];
  resources: readonly Resource[];
  /** `locals` of a synthesized stack; empty for an HCL stack. */
  locals: Readonly<Record<string, unknown>>;
  /** Module calls of a synthesized stack; empty for an HCL stack. */
  modules: readonly ModuleCall[];
  /** The stack's source with comments removed, for name scans. */
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

export function blocksOf(
  blocks: readonly HclBlock[],
  type: string,
  ...labels: string[]
): HclBlock[] {
  return blocks.filter(
    (block) =>
      block.type === type &&
      labels.every((label, index) => block.labels[index] === label),
  );
}

function hclResources(stack: string, blocks: readonly HclBlock[]): Resource[] {
  return blocksOf(blocks, "resource").map((block) => ({
    stack,
    type: block.labels[0] ?? "",
    name: block.labels[1] ?? "",
    attributes: block.attributes,
  }));
}

/** An attribute's literal string, from either an HCL expression or a JSON value. */
export function text(
  resource: Resource,
  attribute: string,
): string | undefined {
  return literalString(resource.attributes.get(attribute));
}

/** Source text with `#` and `//` line comments removed, strings kept. */
function withoutHclComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === "\\") index += 1;
        else if (char === '"') quoted = !quoted;
        else if (!quoted && (char === "#" || line.startsWith("//", index)))
          return line.slice(0, index);
      }
      return line;
    })
    .join("\n");
}

async function readHclFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for await (const file of new Bun.Glob("*.tf").scan({ cwd: directory }))
    files.push(file);
  return Promise.all(
    files.toSorted().map((file) => Bun.file(path.join(directory, file)).text()),
  );
}

export async function readStack(name: string): Promise<Stack> {
  const directory = path.join(TOFU_ROOT, name);
  const synthesized = Bun.file(path.join(directory, "main.tf.json"));
  if (await synthesized.exists()) {
    const source = await synthesized.text();
    const stack = SynthesizedStackSchema.parse(JSON.parse(source));
    return {
      name,
      blocks: [],
      resources: Object.entries(stack.resource ?? {}).flatMap(
        ([type, byName]) =>
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
  const sources = await readHclFiles(directory);
  const blocks = sources.flatMap((source) => parseHcl(source));
  const backend = blocksOf(blocks, "terraform")
    .flatMap((terraform) => blocksOf(terraform.blocks, "backend", "s3"))
    .map((s3) => objectEntries(s3.attributes.get("endpoints"))?.get("s3"))[0];
  return {
    name,
    blocks,
    resources: hclResources(name, blocks),
    locals: {},
    modules: [],
    text: sources.map((source) => withoutHclComments(source)).join("\n"),
    backendEndpoint: literalString(backend),
  };
}

export async function stackNames(): Promise<string[]> {
  const names = new Set<string>();
  for await (const file of new Bun.Glob("*/{*.tf,main.tf.json}").scan({
    cwd: TOFU_ROOT,
  }))
    names.add(file.split("/")[0] ?? "");
  return [...names].toSorted();
}
