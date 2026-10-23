import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  CatalogConfigurationSchema,
  CatalogRecipeSchema,
} from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { CATALOG_CORE, type CatalogCore } from "./core.ts";
import {
  type CatalogDocument,
  parseCatalogDocument,
} from "@shepherdjerred/ops-model/catalog-document.ts";

/**
 * Each environment's current recipe and configuration revision live in
 * `packages/delivery/registrations/v2/<service>/<environment>/` as
 * `recipe.json` and `configuration.json`. The homelab recipe generator writes
 * them from the Application constructors and its agreement test fails when a
 * committed file and its constructor disagree. Superseded revisions stay
 * readable in Delivery and in Git history (P1); the catalog carries the
 * revision each environment declares now.
 */
export const CATALOG_REVISIONS_DIRECTORY = new URL(
  "../../../delivery/registrations/v2/",
  import.meta.url,
);

export type CatalogRevisionFiles = {
  recipes: z.infer<typeof CatalogRecipeSchema>[];
  configurations: z.infer<typeof CatalogConfigurationSchema>[];
};

const RevisionFileSchema = z.enum(["recipe.json", "configuration.json"]);

/** The revision files of every catalog environment; a missing, stray or mismatched file fails. */
export async function readCatalogRevisions(
  directory: URL = CATALOG_REVISIONS_DIRECTORY,
  core: CatalogCore = CATALOG_CORE,
): Promise<CatalogRevisionFiles> {
  const root = fileURLToPath(directory);
  const expected = new Map<string, string>();
  for (const environment of core.environments) {
    expected.set(`${environment.id}/recipe.json`, environment.recipeRevisionId);
    expected.set(
      `${environment.id}/configuration.json`,
      environment.configurationRevisionId,
    );
  }
  const recipes: CatalogRevisionFiles["recipes"] = [];
  const configurations: CatalogRevisionFiles["configurations"] = [];
  const found = new Set<string>();
  const files = await Array.fromAsync(
    new Bun.Glob("**/*.json").scan({ cwd: root, onlyFiles: true }),
  );
  for (const file of files.toSorted()) {
    const revisionId = expected.get(file);
    if (revisionId === undefined)
      throw new Error(
        `Catalog revision file ${file} belongs to no catalog environment`,
      );
    const raw: unknown = await Bun.file(`${root}/${file}`).json();
    const revision =
      RevisionFileSchema.parse(file.slice(file.lastIndexOf("/") + 1)) ===
      "recipe.json"
        ? CatalogRecipeSchema.parse(raw)
        : CatalogConfigurationSchema.parse(raw);
    if (revision.id !== revisionId)
      throw new Error(
        `Catalog revision file ${file} holds ${revision.id}; its environment declares ${revisionId}`,
      );
    if ("definition" in revision) recipes.push(revision);
    else configurations.push(revision);
    found.add(file);
  }
  const missing = [...expected.keys()].filter((file) => !found.has(file));
  if (missing.length > 0)
    throw new Error(
      `Catalog revision files are missing: ${missing.join(", ")}`,
    );
  return { recipes, configurations };
}

/** The complete catalog document: the reviewed core plus every environment's revision files. */
export async function loadCatalogDocument(
  directory: URL = CATALOG_REVISIONS_DIRECTORY,
  core: CatalogCore = CATALOG_CORE,
): Promise<CatalogDocument> {
  const revisions = await readCatalogRevisions(directory, core);
  return parseCatalogDocument({ ...core, ...revisions });
}
