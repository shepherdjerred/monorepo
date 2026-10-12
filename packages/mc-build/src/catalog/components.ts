/**
 * The shared components library: `components/<name>/{index.ts, demo.ts,
 * meta.json, demo.png}` in this package. Build programs import components as
 * `@shepherdjerred/mc-build/components/<name>/index.ts`; each exports pure
 * functions that take the build context.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { COMPONENT_PREFIX, COMPONENTS_DIR } from "#src/compile/scan.ts";

export const ComponentNameSchema = z
  .string()
  .regex(/^[a-z0-9-]{2,40}$/u, "lowercase letters, digits and hyphens");

export const ComponentMetaSchema = z.strictObject({
  name: ComponentNameSchema,
  description: z.string().min(1),
  tags: z.array(z.string().regex(/^[a-z0-9-]+$/u)),
  /** One line per export: signature and what it does. */
  exports: z.array(z.string().min(1)).min(1),
});
export type ComponentMeta = z.infer<typeof ComponentMetaSchema>;

export type ComponentEntry = {
  name: string;
  dir: string;
  /** What build programs import. */
  specifier: string;
  entry: string;
  demo: string;
  render: string;
  meta: ComponentMeta;
};

function entryFor(
  dir: string,
  name: string,
  meta: ComponentMeta,
): ComponentEntry {
  const componentDir = path.join(dir, name);
  return {
    name,
    dir: componentDir,
    specifier: `${COMPONENT_PREFIX}${name}/index.ts`,
    entry: path.join(componentDir, "index.ts"),
    demo: path.join(componentDir, "demo.ts"),
    render: path.join(componentDir, "demo.png"),
    meta,
  };
}

export async function listComponents(
  dir: string = COMPONENTS_DIR,
): Promise<ComponentEntry[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
  const names = dirents
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  return Promise.all(
    names.map(async (name) => {
      const meta = ComponentMetaSchema.parse(
        await Bun.file(path.join(dir, name, "meta.json")).json(),
      );
      if (meta.name !== name) {
        throw new Error(
          `components/${name}/meta.json names "${meta.name}"; the directory and name must match`,
        );
      }
      return entryFor(dir, name, meta);
    }),
  );
}

export async function findComponent(
  name: string,
  dir: string = COMPONENTS_DIR,
): Promise<ComponentEntry> {
  const entries = await listComponents(dir);
  const entry = entries.find((candidate) => candidate.name === name);
  if (entry === undefined) {
    throw new Error(
      `No component "${name}"; available: ${entries.map((e) => e.name).join(", ")}`,
    );
  }
  return entry;
}

/** Components carrying every tag whose name, description or tags contain `text`. */
export function filterComponents(
  entries: readonly ComponentEntry[],
  query: { tags: readonly string[]; text?: string },
): ComponentEntry[] {
  const text = query.text?.toLowerCase();
  return entries.filter((entry) => {
    const tagged = query.tags.every((tag) => entry.meta.tags.includes(tag));
    const haystack =
      `${entry.name} ${entry.meta.description} ${entry.meta.tags.join(" ")}`.toLowerCase();
    return tagged && (text === undefined || haystack.includes(text));
  });
}
