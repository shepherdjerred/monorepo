import type { ReactElement } from "react";
import type { RenderLinkProps } from "@shepherdjerred/console-ui/components/link.tsx";
import { plainLink } from "@shepherdjerred/console-ui/components/link.tsx";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";

export type BackLinkProps = {
  readonly href: string;
  /** Where it goes: "Alerts" reads "Back to Alerts" to a screen reader. */
  readonly label: string;
  readonly renderLink?: (props: RenderLinkProps) => ReactElement;
};

const Back = ICONS.back;

/** The arrow link for a `HeaderBar`'s `lead`. */
export function BackLink({
  href,
  label,
  renderLink = plainLink,
}: BackLinkProps): React.JSX.Element {
  return renderLink({
    href,
    className: "ui-back-link",
    "aria-current": undefined,
    children: (
      <>
        <Back aria-hidden="true" />
        <span className="ui-sr-only">Back to </span>
        {label}
      </>
    ),
  });
}
