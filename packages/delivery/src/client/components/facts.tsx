import type { ReactNode } from "react";

/** The label/value definition list: every `Fact` inside is one labelled value. */
export function Facts({ children }: { children: ReactNode }) {
  return <dl className="facts">{children}</dl>;
}

/** One labelled value in a `Facts` list; `mono` sets an identifier in monospace. */
export function Fact({
  label,
  mono = false,
  children,
}: {
  label: ReactNode;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{children}</dd>
    </div>
  );
}
