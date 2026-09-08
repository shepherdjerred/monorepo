import type { ReactNode } from "react";

/**
 * A titled section with a bordered body. Shared by the player, competition,
 * and report detail pages so their table panels look identical.
 */
export function Section(props: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{props.title}</h3>
        {props.action}
      </div>
      <div className="rounded-md border border-border">{props.children}</div>
    </section>
  );
}
