import { ArrowRight } from "lucide-react";

/**
 * A small boxes-and-arrow diagram that makes the Player → Accounts and
 * Player → Subscription → channel relationship visible at a glance, shown
 * alongside the concept copy.
 */
export function OnboardingConceptDiagram() {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <DiagramCard label="Player" title="sjerred">
          <div className="mt-2 flex flex-wrap gap-1">
            <Chip>nightblue#NA1</Chip>
            <Chip>smurf#EUW</Chip>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">2 accounts</p>
        </DiagramCard>

        <div className="flex items-center justify-center text-muted-foreground">
          <ArrowRight className="hidden h-5 w-5 sm:block" aria-hidden="true" />
          <span className="sm:hidden" aria-hidden="true">
            ↓
          </span>
        </div>

        <DiagramCard label="Subscription" title="#match-reports">
          <p className="mt-2 text-xs text-muted-foreground">
            Reports post here after each game
          </p>
        </DiagramCard>
      </div>
    </div>
  );
}

function DiagramCard(props: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 rounded-md border border-border bg-card p-3 text-card-foreground">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {props.label}
      </p>
      <p className="font-semibold">{props.title}</p>
      {props.children}
    </div>
  );
}

function Chip(props: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
      {props.children}
    </span>
  );
}
