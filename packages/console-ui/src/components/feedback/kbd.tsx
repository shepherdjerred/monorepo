import type { ReactNode } from "react";

/** A keycap: `<Kbd>/</Kbd>`, `<Kbd>⌘</Kbd><Kbd>K</Kbd>`. */
export function Kbd({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return <kbd className="ui-kbd">{children}</kbd>;
}
