import { chipVariants } from "@scout-for-lol/design-system/components/surfaces/chip";
import {
  PageLoading,
  PageState,
} from "@scout-for-lol/design-system/domain/profile/page-states";
import { Link } from "react-router";
import type { ReactNode } from "react";

/** The column both champion pages sit in. */
export function ChampionsShell(props: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-[1128px] gap-7 px-4 py-5 sm:px-8 sm:pt-8 sm:pb-14">
      {props.children}
    </div>
  );
}

export function ChampionsLoading() {
  return (
    <ChampionsShell>
      <PageLoading shape="list" rows={6} label="Loading…" />
    </ChampionsShell>
  );
}

/** The page could not be read: say so, and offer the retry. */
export function ChampionsUnavailable(props: {
  title: string;
  lead: string;
  onRetry: () => void;
}) {
  return (
    <ChampionsShell>
      <PageState
        kind="unavailable"
        level={1}
        id="champions-unavailable"
        title={props.title}
        lead={props.lead}
        actions={
          <>
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
          </>
        }
      />
    </ChampionsShell>
  );
}
