import { useSearchParams } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { PageTitle } from "#client/components.tsx";
import { HistoryFilters } from "./filters.tsx";
import { NowPlaying } from "./now-playing.tsx";
import { PlaysSection } from "./plays.tsx";
import { StatisticsSection } from "./statistics.tsx";
import { EVERYTHING, historySearch, readHistoryView } from "./view.ts";

/**
 * What is playing now and what has been watched. An owner reads the whole
 * household's plays and can narrow them to one person; a member reads only
 * their own, which is the API's rule and not this page's.
 */
export function HistoryPage({ user }: { user: MediaUser }) {
  const [params, setParams] = useSearchParams();
  const view = readHistoryView(params);
  const owner = user.role === "owner";
  return (
    <>
      <PageTitle title="History">
        <p>
          {owner
            ? "What is playing now, and what the household has watched."
            : "What is playing now, and what you have watched."}
        </p>
      </PageTitle>
      <NowPlaying showsViewer={owner} />
      <HistoryFilters
        view={view}
        owner={owner}
        onChange={(change) => {
          // A change builds on the address as it is now, not on the view
          // this render read: the address can be a keystroke ahead of it.
          const current = readHistoryView(
            new URLSearchParams(globalThis.location.search),
          );
          // Typing and choosing refine one view; they are not steps to go
          // back through one letter at a time.
          setParams(historySearch({ ...current, ...change }), {
            replace: true,
            preventScrollReset: true,
          });
        }}
      />
      <StatisticsSection view={view} showsViewers={owner} />
      <PlaysSection
        view={view}
        owner={owner}
        clearedSearch={historySearch(EVERYTHING)}
      />
    </>
  );
}
