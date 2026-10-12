/**
 * The curated build library: `library/<slug>/{build.ts, meta.json}` in this
 * package. Programs teach better than schematics, so entries are DSL source an
 * agent can read, copy into a build directory and adapt.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const LIBRARY_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "library",
);

export const LibraryMetaSchema = z.strictObject({
  title: z.string().min(1),
  tags: z.array(z.string().regex(/^[a-z0-9-]+$/u)).min(1),
  style: z.enum(["medieval", "nordic", "desert", "rustic", "fantasy"]),
  footprint: z.strictObject({
    w: z.number().int().positive(),
    d: z.number().int().positive(),
    h: z.number().int().positive(),
  }),
  notes: z.string().min(1),
});
export type LibraryMeta = z.infer<typeof LibraryMetaSchema>;

export type LibraryEntry = {
  slug: string;
  dir: string;
  program: string;
  meta: LibraryMeta;
};

export async function listLibrary(
  dir: string = LIBRARY_DIR,
): Promise<LibraryEntry[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
  const slugs = dirents
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  return Promise.all(
    slugs.map(async (slug) => {
      const entryDir = path.join(dir, slug);
      const meta = LibraryMetaSchema.parse(
        await Bun.file(path.join(entryDir, "meta.json")).json(),
      );
      return {
        slug,
        dir: entryDir,
        program: path.join(entryDir, "build.ts"),
        meta,
      };
    }),
  );
}

export async function findLibraryEntry(
  slug: string,
  dir: string = LIBRARY_DIR,
): Promise<LibraryEntry> {
  const entries = await listLibrary(dir);
  const entry = entries.find((candidate) => candidate.slug === slug);
  if (entry === undefined) {
    throw new Error(
      `No library entry "${slug}"; available: ${entries.map((e) => e.slug).join(", ")}`,
    );
  }
  return entry;
}

/**
 * Entries carrying every tag in `tags` (or matching the style) whose title,
 * tags or notes contain `text` when given.
 */
export async function searchLibrary(
  query: { tags?: readonly string[]; text?: string },
  dir: string = LIBRARY_DIR,
): Promise<LibraryEntry[]> {
  const text = query.text?.toLowerCase();
  const entries = await listLibrary(dir);
  return entries.filter((entry) => {
    const labels = new Set([...entry.meta.tags, entry.meta.style]);
    const tagged = (query.tags ?? []).every((tag) => labels.has(tag));
    const haystack =
      `${entry.meta.title} ${entry.meta.tags.join(" ")} ${entry.meta.notes}`.toLowerCase();
    return tagged && (text === undefined || haystack.includes(text));
  });
}
