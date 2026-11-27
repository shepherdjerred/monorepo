import type { PlayerId } from "@scout-for-lol/data";
import { chipVariants } from "@scout-for-lol/design-system/components/surfaces/chip";
import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import type { ReactNode } from "react";
import {
  AboutMore,
  type ChallengeRun,
} from "#src/components/player-profile/about-more.tsx";
import { BestChampionsPanel } from "#src/components/player-profile/best-champions.tsx";
import {
  FeedControls,
  type FilterKind,
} from "#src/components/player-profile/feed-controls.tsx";
import { HighlightsPanel } from "#src/components/player-profile/highlights-panel.tsx";
import { LatelyPanel } from "#src/components/player-profile/lately-panel.tsx";
import { PlaysWithPanel } from "#src/components/player-profile/plays-with.tsx";
import { ProfileHero } from "#src/components/player-profile/profile-hero.tsx";
import { RecentGames } from "#src/components/player-profile/recent-games.tsx";
import { SplitPanel } from "#src/components/player-profile/split-panel.tsx";
import {
  SECTION_HEADING,
  TWO_COLUMNS,
} from "#src/components/friendly-classes.ts";
import { FriendlyPage } from "#src/components/friendly-page.tsx";
import type { FeedRow, SplitClimb } from "#src/lib/player/player-feed.ts";
import {
  bestChampions,
  latelyLines,
  playsWith,
  stickers,
  type PlayerSummary,
} from "#src/lib/player/player-page.ts";
import type { PlayerProfileFilters } from "#src/lib/player/player-profile-filters.ts";

/** This split's climb: drawn, absent, or failed to load. */
export type SplitSection =
  | { kind: "climb"; climb: SplitClimb }
  | { kind: "failed"; onRetry: () => void }
  | { kind: "none" };

function SplitFailed(props: { onRetry: () => void }) {
  return (
    <Panel asChild>
      <section aria-labelledby="split-h">
        <h2 id="split-h" className={SECTION_HEADING}>
          This split
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="m-0 text-scout-subtle">
            Rank history could not be loaded.
          </p>
          <button
            type="button"
            className={chipVariants()}
            onClick={props.onRetry}
          >
            Retry
          </button>
        </div>
      </section>
    </Panel>
  );
}

function splitSection(split: SplitSection): ReactNode {
  if (split.kind === "none") return null;
  return split.kind === "climb" ? (
    <SplitPanel climb={split.climb} />
  ) : (
    <SplitFailed onRetry={split.onRetry} />
  );
}

/**
 * A player: the hero, how the newest games went, the games themselves and
 * who they play with on the left; best champions, the split, highlights and
 * the rest on the right.
 */
export function ProfileView(props: {
  playerId: PlayerId;
  summary: PlayerSummary;
  filters: PlayerProfileFilters;
  onFilters: (filters: PlayerProfileFilters, kind: FilterKind) => void;
  feed: readonly FeedRow[];
  feedFailed: { onRetry: () => void } | undefined;
  split: SplitSection;
  challenges: readonly ChallengeRun[];
  nowMs: number;
}) {
  const { summary } = props;
  const lately = latelyLines(summary);
  const friends = playsWith(summary);
  const champions = bestChampions(summary);
  const earned = stickers(summary);
  return (
    <FriendlyPage>
      <ProfileHero summary={summary} />
      <div className={TWO_COLUMNS}>
        <div className="grid min-w-0 gap-7">
          {lately === null ? null : <LatelyPanel lately={lately} />}
          <RecentGames
            playerId={props.playerId}
            rows={props.feed}
            failed={props.feedFailed}
            controls={
              <FeedControls
                filters={props.filters}
                onChange={props.onFilters}
              />
            }
          />
          {friends === null ? null : <PlaysWithPanel playsWith={friends} />}
        </div>
        <div className="grid min-w-0 gap-7">
          {champions.length === 0 ? null : (
            <BestChampionsPanel champions={champions} />
          )}
          {splitSection(props.split)}
          {earned.length === 0 ? null : (
            <HighlightsPanel
              playerId={props.playerId}
              stickers={earned}
              nowMs={props.nowMs}
            />
          )}
          <AboutMore summary={summary} challenges={props.challenges} />
        </div>
      </div>
    </FriendlyPage>
  );
}
