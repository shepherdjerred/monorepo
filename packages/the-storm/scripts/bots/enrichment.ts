/**
 * Authored text for personalities: voice, chat lines, quirks, rivals and bio.
 * The generator writes no prose; it merges these files, keyed by personality
 * id, and refuses a catalog with an id that has no enrichment or enrichment
 * for an id that does not exist.
 */
import path from "node:path";
import {
  EnrichmentFileSchema,
  type Enrichment,
  type EnrichmentFile,
} from "./schema.ts";

export type LoadedEnrichment = {
  /** The files read, as given on the command line. */
  files: string[];
  byId: Map<string, Enrichment>;
};

/** Reads and validates every file; an id in two files is an error. */
export async function loadEnrichment(
  files: readonly string[],
): Promise<LoadedEnrichment> {
  const byId = new Map<string, Enrichment>();
  const source = new Map<string, string>();
  const problems: string[] = [];
  for (const file of files) {
    const parsed: EnrichmentFile = EnrichmentFileSchema.parse(
      await Bun.file(file).json(),
    );
    for (const [id, enrichment] of Object.entries(parsed.personalities)) {
      const earlier = source.get(id);
      if (earlier !== undefined) {
        problems.push(
          `${id} is enriched in both ${earlier} and ${path.basename(file)}`,
        );
      }
      source.set(id, path.basename(file));
      byId.set(id, enrichment);
    }
  }
  if (problems.length > 0) {
    throw new Error(`invalid enrichment:\n${problems.join("\n")}`);
  }
  return { files: [...files], byId };
}

/**
 * The enrichment of every id in `ids`, in order. Reports every id without
 * enrichment and every enriched id that is not in the catalog.
 */
export function enrichmentFor(
  loaded: LoadedEnrichment,
  ids: readonly string[],
): Enrichment[] {
  const known = new Set(ids);
  const missing = ids.filter((id) => !loaded.byId.has(id));
  const unknown = [...loaded.byId.keys()].filter((id) => !known.has(id));
  const problems = [
    ...missing.map((id) => `no enrichment for ${id}`),
    ...unknown.map((id) => `enrichment for unknown personality ${id}`),
  ];
  if (problems.length > 0) {
    throw new Error(
      `enrichment does not match the catalog:\n${problems.join("\n")}`,
    );
  }
  return ids.map((id) => {
    const enrichment = loaded.byId.get(id);
    if (enrichment === undefined) {
      throw new Error(`no enrichment for ${id}`);
    }
    return enrichment;
  });
}
