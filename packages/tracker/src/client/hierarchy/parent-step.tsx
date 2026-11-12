import { Unlink } from "lucide-react";
import { loadedIssue } from "#client/data/mutations.ts";
import { applyChange } from "#client/controls/issue-actions.ts";
import type { PaletteStep } from "#client/shell/palette-steps.tsx";
import { cannotParent, removeParent } from "./hierarchy-actions.ts";

/** The palette's parent step: search for the issue to put these under. */
export function parentStep(identifiers: string[]): PaletteStep {
  const parented = identifiers.some(
    (identifier) => loadedIssue(identifier).parent !== null,
  );
  return {
    id: "parent",
    title: "Set parent",
    placeholder: "Search for the parent issue…",
    issues: {
      exclude: cannotParent(identifiers),
      pick: (parentIdentifier) => {
        applyChange(identifiers, { kind: "parent", parentIdentifier });
      },
    },
    entries: () =>
      parented
        ? [
            {
              id: "parent:none",
              label: "Remove parent",
              icon: <Unlink size={15} />,
              section: "Parent",
              run: () => {
                removeParent(identifiers);
              },
            },
          ]
        : [],
  };
}
