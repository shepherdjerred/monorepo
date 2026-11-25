import { DEMO_CATALOG_SUMMARY, EMPTY_CATALOG_SUMMARY } from "./fixtures.ts";
import {
  parseCatalogSummary,
  type CatalogSummary,
  type FixtureMode,
} from "./model.ts";

export async function fetchCatalogSummary(
  fixture: FixtureMode | null,
  signal?: AbortSignal,
): Promise<CatalogSummary> {
  if (fixture === "demo") {
    return DEMO_CATALOG_SUMMARY;
  }
  if (fixture === "empty") {
    return EMPTY_CATALOG_SUMMARY;
  }

  try {
    const response = await fetch(
      "/api/summary",
      signal === undefined ? {} : { signal },
    );
    if (!response.ok) {
      throw new Error(`HTTP ${String(response.status)}`);
    }
    const json: unknown = await response.json();
    return parseCatalogSummary(json);
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }
    if (import.meta.env.DEV) {
      return DEMO_CATALOG_SUMMARY;
    }
    throw error;
  }
}
