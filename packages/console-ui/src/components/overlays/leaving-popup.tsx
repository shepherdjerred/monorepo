import type { HTMLAttributes, ReactElement } from "react";

/**
 * Base UI keeps a popup mounted while it fades closed. For that moment it is
 * already gone as far as anyone can tell: inert, so focus and the next key
 * press leave it at once, and out of the accessibility tree, so whatever
 * opens next is the only one there. Pass it as a popup's `render`.
 */
export function leavingPopup(
  props: HTMLAttributes<HTMLDivElement>,
  state: { readonly open: boolean },
): ReactElement {
  return state.open ? (
    <div {...props} />
  ) : (
    <div {...props} aria-hidden="true" inert />
  );
}
