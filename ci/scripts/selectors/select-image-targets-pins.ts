import {
  resolveManagedImagePins,
  UNPUBLISHED_IMAGE_DIGEST,
} from "../../../scripts/lib/image-pin-catalog.ts";
import { APPLICATION_IMAGE_TARGETS } from "../images/image-targets.ts";

function addReason(
  reasons: Map<string, string[]>,
  target: string,
  reason: string,
): void {
  const existing = reasons.get(target);
  if (existing === undefined) {
    reasons.set(target, [reason]);
  } else if (!existing.includes(reason)) {
    existing.push(reason);
  }
}

// A zero digest is a deliberate pre-first-publish placeholder, not a usable
// deployment pin. Keep selecting its target on every main image release until
// the version commit-back writes the first real digest; otherwise unrelated
// changes can leave a newly introduced application permanently undeployable.
export async function unpublishedImagePinInspectionFailure(options: {
  readonly repoRoot: string;
  readonly versionCatalogSource?: string | undefined;
  readonly reasons: Map<string, string[]>;
}): Promise<string | undefined> {
  try {
    const versionCatalogSource =
      options.versionCatalogSource ??
      (await Bun.file(
        `${options.repoRoot}/packages/version-catalog/src/catalog.json`,
      ).text());
    for (const { name, pin } of resolveManagedImagePins(
      versionCatalogSource,
      APPLICATION_IMAGE_TARGETS,
    )) {
      if (pin.digest === UNPUBLISHED_IMAGE_DIGEST) {
        addReason(
          options.reasons,
          name,
          `unpublished image pin ${pin.key} requires its first release`,
        );
      }
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
