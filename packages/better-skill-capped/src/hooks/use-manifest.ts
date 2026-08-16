import {
  MANIFEST_SCHEMA_VERSION,
  ManifestSchema,
  type Manifest,
} from "#src/parser/manifest";

export const MANIFEST_QUERY_KEY = ["manifest", MANIFEST_SCHEMA_VERSION];

export async function fetchManifest(): Promise<Manifest> {
  const response = await fetch("/data/manifest.json");
  if (!response.ok) {
    throw new Error(
      `Manifest fetch failed with status ${String(response.status)}`,
    );
  }
  return ManifestSchema.parse(await response.json());
}
