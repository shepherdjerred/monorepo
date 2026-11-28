import type { ReactNode } from "react";
import { Button } from "@shepherdjerred/console-ui/components/button.tsx";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";

export type BulkBarProps = {
  /** Selected rows; the bar shows only while this is above zero. */
  readonly count: number;
  /** Buttons that act on the selection. */
  readonly actions?: ReactNode;
  readonly onClear: () => void;
  /** The region's name; "Bulk actions" by default. */
  readonly label?: string | undefined;
};

/**
 * The bar that appears while rows are selected: "N selected", the actions
 * and "Clear selection". It sticks to the bottom of the viewport while its
 * section scrolls by. The count is announced politely from a live region
 * that is always mounted, so the first selection is heard too.
 */
export function BulkBar({
  count,
  actions,
  onClear,
  label = "Bulk actions",
}: BulkBarProps): React.JSX.Element {
  const Close = ICONS.close;
  const text = `${String(count)} selected`;
  return (
    <>
      <span className="ui-sr-only" role="status">
        {count > 0 ? text : ""}
      </span>
      {count > 0 ? (
        <div className="ui-bulkbar" role="region" aria-label={label}>
          <span className="ui-bulkbar-count">{text}</span>
          {actions === undefined ? null : (
            <div className="ui-bulkbar-actions">{actions}</div>
          )}
          <Button className="ui-bulkbar-clear" onClick={onClear}>
            <Close aria-hidden="true" />
            Clear selection
          </Button>
        </div>
      ) : null}
    </>
  );
}
