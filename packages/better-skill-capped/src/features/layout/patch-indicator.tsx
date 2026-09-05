import { Loaded } from "@shepherdjerred/loaded";
import React from "react";
import { useContent } from "#src/hooks/use-content";

/**
 * Current game patch + manifest freshness. Deliberately not a link: the
 * manifest's patchUrl is stale in production (it points at years-old patch
 * notes), so only the version number is trustworthy.
 */
export function PatchIndicator(): React.ReactElement | null {
  const content = Loaded.getOrElse(useContent().content, undefined);
  if (content === undefined) {
    return null;
  }
  return (
    <p className="text-xs text-primary-foreground/70">
      Patch {content.patch.version} · catalog updated{" "}
      {content.generatedAt.toLocaleDateString()}
    </p>
  );
}
