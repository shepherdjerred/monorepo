import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@shepherdjerred/console-ui";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { DiffView } from "./code.tsx";
import { reviewText } from "./model.ts";

export type ConflictBannerProps = {
  /** The revision another write landed at. */
  readonly revision: number;
  /** The flag as stored now; undefined when the other write removed it. */
  readonly theirs: FlagValue | undefined;
  readonly draft: FlagValue;
  readonly onLoadTheirs: () => void;
};

/** Warns that a save was not applied and diffs their flag against the draft. */
export function ConflictBanner({
  revision,
  theirs,
  draft,
  onLoadTheirs,
}: ConflictBannerProps): React.JSX.Element {
  return (
    <section
      className="fl-conflict"
      role="alert"
      aria-labelledby="conflict-title"
    >
      <h3 id="conflict-title" className="fl-conflict-title">
        <TriangleAlertIcon aria-hidden="true" />
        Revision conflict
      </h3>
      <p>
        Another write landed at revision {revision}. This save was not applied.
      </p>
      {theirs === undefined ? (
        <p>This flag is gone from their document.</p>
      ) : (
        <>
          <p className="fl-conflict-legend ui-muted">
            Their flag (before) against your draft (after).
          </p>
          <DiffView
            original={reviewText(theirs)}
            modified={reviewText(draft)}
            labels={{ original: "Their flag", modified: "Your draft" }}
          />
          <Button type="button" onClick={onLoadTheirs}>
            Load their version
          </Button>
        </>
      )}
    </section>
  );
}
