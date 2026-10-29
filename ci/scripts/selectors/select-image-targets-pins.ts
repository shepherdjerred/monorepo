import {
  CANONICAL_IMAGE_TARGETS,
  type QualifiedImageInventory,
} from "../../../scripts/lib/image-pin-catalog.ts";
import { INFRASTRUCTURE_IMAGE_TARGETS } from "../images/image-targets.ts";

/** Missing PG originals are built on main, without asking PR selectors for credentials. */
export function includeMissingQualifiedImages(
  selected: readonly string[],
  originals: QualifiedImageInventory,
  eligible: readonly string[] = CANONICAL_IMAGE_TARGETS,
): string[] {
  return [
    ...new Set([
      ...selected,
      ...eligible
        .filter((name) => !originals.has(name))
        .map((name) =>
          INFRASTRUCTURE_IMAGE_TARGETS.includes(name) ? "infra" : name,
        ),
    ]),
  ].sort();
}
