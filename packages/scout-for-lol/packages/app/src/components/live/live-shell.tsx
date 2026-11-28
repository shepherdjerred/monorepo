import { chipVariants } from "@scout-for-lol/design-system/components/surfaces/chip";
import { EmptyState } from "@scout-for-lol/design-system/layout";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { DelayedLoadingState } from "#src/components/chrome/section-skeleton.tsx";

/** The column the Live pages sit in. */
export function LiveShell(props: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-[1128px] gap-7 px-4 py-5 sm:px-8 sm:pt-8 sm:pb-14">
      {props.children}
    </div>
  );
}

export function LiveLoading() {
  return (
    <LiveShell>
      <DelayedLoadingState />
    </LiveShell>
  );
}

/** The page could not be read: say so, and offer the retry. */
export function LiveUnavailable(props: { title: string; onRetry: () => void }) {
  return (
    <LiveShell>
      <EmptyState>
        <h1 className="m-0 font-display text-2xl font-bold">{props.title}</h1>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className={chipVariants({ variant: "default" })}
            onClick={props.onRetry}
          >
            Retry
          </button>
          <Link to="/players" className={chipVariants({ variant: "ghost" })}>
            Players
          </Link>
        </div>
      </EmptyState>
    </LiveShell>
  );
}

/** A game that is over, or that this viewer has no friend in. */
export function LiveGameGone() {
  return (
    <LiveShell>
      <EmptyState>
        <h1 className="m-0 font-display text-2xl font-bold">
          This game is no longer available
        </h1>
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/live" className={chipVariants({ variant: "default" })}>
            Live games
          </Link>
          <Link to="/players" className={chipVariants({ variant: "ghost" })}>
            Players
          </Link>
        </div>
      </EmptyState>
    </LiveShell>
  );
}
