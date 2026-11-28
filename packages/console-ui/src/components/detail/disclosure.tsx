import type { ReactNode } from "react";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";

export type DisclosureProps = {
  readonly title: ReactNode;
  /** Muted count after the title, e.g. the number of hidden rows. */
  readonly count?: ReactNode;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
};

const Twist = ICONS.expand;

/** A native `<details>` with a twisting chevron; works without script. */
export function Disclosure({
  title,
  count,
  defaultOpen = false,
  children,
}: DisclosureProps): React.JSX.Element {
  return (
    <details className="ui-disclosure" open={defaultOpen ? true : undefined}>
      <summary className="ui-disclosure-summary">
        <Twist aria-hidden="true" />
        <span className="ui-disclosure-title">{title}</span>
        {count === undefined ? null : <span className="ui-count">{count}</span>}
      </summary>
      <div className="ui-disclosure-body">{children}</div>
    </details>
  );
}
