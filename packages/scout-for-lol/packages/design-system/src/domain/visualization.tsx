import type { ReactNode } from "react";
import { cn } from "#src/lib/cn.ts";

export function ChartFrame(props: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("scout-chart-frame scout-panel", props.className)}>
      <header>
        <div>
          <h3>{props.title}</h3>
          {props.description}
        </div>
        {props.actions}
      </header>
      <div className="scout-chart-frame__canvas">{props.children}</div>
    </section>
  );
}
export function InteractiveVisualization(props: {
  label: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return (
    <div role="img" aria-label={props.label} className="scout-visualization">
      {props.children ?? props.fallback}
    </div>
  );
}
