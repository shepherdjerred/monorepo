import type { ReleaseAttributes } from "#shared/contract.ts";
import { projectResolvedCatalog } from "#domain/resolved-evidence.ts";

type Metadata = {
  runtimeMinutes: number | null;
  originalLanguage: string | null;
  parent: {
    originalLanguage: string | null;
    parent?: { originalLanguage: string | null } | null;
  } | null;
};

export function currentMeasuredQuality(
  attributes: ReleaseAttributes,
  media: readonly Metadata[],
): ReleaseAttributes {
  if (attributes.resolvedEvidence === undefined) return attributes;
  const languages = media.map(
    (item) =>
      item.originalLanguage ??
      item.parent?.originalLanguage ??
      item.parent?.parent?.originalLanguage ??
      null,
  );
  const originalLanguage = languages[0];
  return {
    ...attributes,
    resolvedEvidence: projectResolvedCatalog(attributes.resolvedEvidence, {
      runtimeMinutes:
        media.length > 0 && media.every((item) => item.runtimeMinutes !== null)
          ? media.reduce((sum, item) => sum + (item.runtimeMinutes ?? 0), 0)
          : null,
      originalLanguage:
        originalLanguage !== undefined &&
        languages.every((language) => language === originalLanguage)
          ? originalLanguage
          : null,
    }),
  };
}
