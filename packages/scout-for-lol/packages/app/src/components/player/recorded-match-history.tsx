import type { ComponentProps } from "react";
import type { Loaded } from "@shepherdjerred/loaded";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Section } from "#src/components/player/player-detail-sections.tsx";
import { MatchHistoryList } from "#src/components/player/player-profile-sections.tsx";

export type HistoryCursor = {
  gameCreationMs: number;
  matchId: string;
  consumed?: number | undefined;
};

export function shouldShowMatchHistoryPager(
  entryCount: number,
  page: number,
): boolean {
  return entryCount > 0 || page > 0;
}

export function shouldShowPlayerPerformanceBlank(input: {
  championCount: number;
  matchCount: number;
  historyPage: number;
  historyPending: boolean;
  historyError: boolean;
}): boolean {
  return (
    !input.historyPending &&
    !input.historyError &&
    input.championCount === 0 &&
    input.matchCount === 0 &&
    input.historyPage === 0
  );
}

export function RecordedMatchHistory(props: {
  history: Loaded<unknown>;
  fetching: boolean;
  refetching: boolean;
  entries: ComponentProps<typeof MatchHistoryList>["entries"];
  nextCursor: HistoryCursor | null;
  page: number;
  playerId: number;
  profileSearch: string;
  onRetry: () => void;
  onPrevious: () => void;
  onNext: (cursor: HistoryCursor) => void;
}) {
  const empty = props.entries.length === 0;
  if (props.history.status === "loading" || props.refetching) {
    return (
      <Section title="Recorded match history" framed={false}>
        <p className="text-sm text-scout-subtle">Loading games…</p>
      </Section>
    );
  }
  if (props.history.status === "error") {
    return (
      <Section title="Recorded match history" framed={false}>
        <div className="flex items-center gap-3">
          <p className="text-sm text-scout-danger">
            Match history didn&apos;t load.
          </p>
          <Button size="sm" variant="outline" onClick={props.onRetry}>
            Retry
          </Button>
        </div>
      </Section>
    );
  }
  if (empty && props.page === 0) {
    return (
      <Section title="Recorded match history" framed={false}>
        <p className="text-sm text-scout-subtle">
          Scout hasn&apos;t recorded any games for this player yet.
        </p>
      </Section>
    );
  }
  return (
    <Section title="Recorded match history" framed={false}>
      <div className="space-y-3">
        {empty ? (
          <p className="text-sm text-scout-subtle">
            Scout hasn&apos;t recorded any games for this player yet.
          </p>
        ) : (
          <>
            <p className="text-sm text-scout-subtle">
              This is Scout&apos;s stored coverage, not a complete Riot match
              history. Each card identifies the account Scout observed.
            </p>
            <MatchHistoryList
              entries={props.entries}
              playerId={props.playerId}
              profileSearch={props.profileSearch}
            />
          </>
        )}
        {shouldShowMatchHistoryPager(props.entries.length, props.page) && (
          <MatchHistoryPager
            page={props.page}
            fetching={props.fetching}
            nextCursor={props.nextCursor}
            onPrevious={props.onPrevious}
            onNext={props.onNext}
          />
        )}
      </div>
    </Section>
  );
}

function MatchHistoryPager(props: {
  page: number;
  fetching: boolean;
  nextCursor: HistoryCursor | null;
  onPrevious: () => void;
  onNext: (cursor: HistoryCursor) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-scout-subtle">
        Page {(props.page + 1).toString()}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.page === 0 || props.fetching}
          onClick={props.onPrevious}
        >
          Previous
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.nextCursor === null || props.fetching}
          onClick={() => {
            if (props.nextCursor === null) return;
            props.onNext(props.nextCursor);
          }}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
