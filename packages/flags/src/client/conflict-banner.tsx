import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@shepherdjerred/console-ui";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { flagText } from "./model.ts";

export type ConflictBannerProps = {
  /** The revision another write landed at. */
  readonly revision: number;
  /** The flag as stored now; undefined when the other write removed it. */
  readonly theirs: FlagValue | undefined;
  readonly draft: FlagValue;
  readonly onLoadTheirs: () => void;
};

/** Warns that a save was not applied and shows both versions side by side. */
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
      <div className="fl-compare">
        <section aria-labelledby="conflict-theirs">
          <h4 id="conflict-theirs">Their flag</h4>
          <pre>
            {theirs === undefined
              ? "This flag is gone from their document."
              : flagText(theirs)}
          </pre>
        </section>
        <section aria-labelledby="conflict-yours">
          <h4 id="conflict-yours">Your draft</h4>
          <pre>{flagText(draft)}</pre>
        </section>
      </div>
      {theirs === undefined ? null : (
        <Button type="button" onClick={onLoadTheirs}>
          Load their version
        </Button>
      )}
    </section>
  );
}
