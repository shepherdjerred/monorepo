import IconArrowLeft from "~icons/ph/arrow-left-bold";
import IconDiscord from "~icons/ph/discord-logo-fill";
import {
  characterName,
  courseName,
  type DiscordUser,
  type PlayerStats,
} from "@discord-plays-mario-kart/common";
import { Avatar } from "#src/ui/avatar.tsx";
import { Button } from "#src/ui/button.tsx";
import { cx } from "#src/ui/cx.ts";
import {
  LapTime,
  PanelError,
  PanelLoading,
  PanelMessage,
  StatTile,
} from "./bits.tsx";
import { averagePlace, ordinal, percent } from "./format.ts";
import { usePlayerStats } from "./queries.ts";
import { RaceList } from "./race-list.tsx";

const BAR_STYLES: Record<number, string> = {
  0: "bg-[linear-gradient(180deg,#fff3b0,#ffd23f_40%,#d79a00)]",
  1: "bg-[linear-gradient(180deg,#ffffff,#d9e1ef_40%,#8f9bb3)]",
  2: "bg-[linear-gradient(180deg,#ffd9b8,#e3965a_40%,#9c531d)]",
};

function PlacementChart({ placements }: { placements: readonly number[] }) {
  const max = Math.max(1, ...placements);
  return (
    <div>
      <h3 className="mk-title mb-2 text-base text-white">Finishes</h3>
      <div className="flex h-28 items-end gap-1.5 rounded-xl border border-border-subtle bg-surface-sunken px-3 pt-3 pb-2">
        {placements.map((count, index) => (
          <div
            key={ordinal(index + 1)}
            className="flex h-full flex-1 flex-col items-center justify-end gap-1"
          >
            <span className="text-[10px] font-semibold text-ink-muted tabular-nums">
              {count > 0 ? count : ""}
            </span>
            <div
              className={cx(
                "w-full rounded-t-md",
                BAR_STYLES[index] ??
                  "bg-[linear-gradient(180deg,#4d5ea8,#2b3770)]",
              )}
              style={{ height: `${String(Math.max(3, (count / max) * 100))}%` }}
              title={`${ordinal(index + 1)}: ${String(count)}`}
            />
            <span className="font-display text-[11px] text-ink-muted italic">
              {ordinal(index + 1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsBody({ stats }: { stats: PlayerStats }) {
  const { record } = stats;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Races" value={record.races} />
        <StatTile
          label="Wins"
          value={record.wins}
          sub={`${percent(record.winRate)} win rate`}
        />
        <StatTile
          label="Podiums"
          value={record.podiums}
          sub={`${String(record.losses)} losses`}
        />
        <StatTile
          label="Avg place"
          value={averagePlace(record.averagePlacement)}
          sub={
            stats.favoriteCharacterId === null
              ? undefined
              : `Mains ${characterName(stats.favoriteCharacterId)}`
          }
        />
      </div>
      <PlacementChart placements={stats.placements} />
      {stats.bestTimes.length > 0 ? (
        <div>
          <h3 className="mk-title mb-2 text-base text-white">Best times</h3>
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface-sunken">
            {stats.bestTimes.map((best) => (
              <li
                key={best.courseId}
                className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
              >
                <span className="min-w-0 truncate text-ink">
                  {courseName(best.courseId)}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-ink-faint">
                    {characterName(best.characterId)}
                  </span>
                  <LapTime ms={best.raceTimeMs} className="text-sm" />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {stats.recent.length > 0 ? (
        <div>
          <h3 className="mk-title mb-2 text-base text-white">Recent races</h3>
          <RaceList
            races={stats.recent}
            nowMs={Date.now()}
            highlightId={record.player.discordId}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One driver's record. With no player chosen it shows the signed-in viewer's
 * own stats, or a sign-in prompt.
 */
export function PlayerStatsPanel({
  player,
  me,
  onBack,
  onSignIn,
}: {
  /** The driver picked from the leaderboard, if any. */
  player: DiscordUser | undefined;
  me: DiscordUser | undefined;
  onBack: (() => void) | undefined;
  onSignIn: () => void;
}) {
  const subject = player ?? me;
  const query = usePlayerStats(subject?.discordId);

  if (subject === undefined) {
    return (
      <PanelMessage title="Your stats live here">
        <p>Sign in with Discord to track your wins, podiums, and best times.</p>
        <Button
          variant="discord"
          size="sm"
          className="mt-3"
          icon={<IconDiscord />}
          onClick={onSignIn}
        >
          Sign in with Discord
        </Button>
      </PanelMessage>
    );
  }

  const header = (
    <div className="mb-4 flex items-center gap-3">
      {onBack === undefined ? null : (
        <button
          type="button"
          aria-label="Back to the leaderboard"
          className="inline-flex size-8 items-center justify-center rounded-lg text-ink-faint hover:bg-white/5 hover:text-ink"
          onClick={onBack}
        >
          <IconArrowLeft />
        </button>
      )}
      <Avatar
        name={subject.name}
        url={subject.avatarUrl}
        seed={subject.discordId}
        size="lg"
      />
      <div className="min-w-0">
        <div className="mk-title truncate text-2xl leading-tight text-white">
          {subject.name}
        </div>
        <div className="truncate text-xs text-ink-faint">
          @{subject.username}
        </div>
      </div>
    </div>
  );

  if (query.isPending) {
    return (
      <>
        {header}
        <PanelLoading />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        {header}
        <PanelError
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </>
    );
  }
  return (
    <>
      {header}
      {query.data === null ? (
        <PanelMessage title="No ranked races yet">
          Grand Prix and VS races count. Time trials and battles don&apos;t.
        </PanelMessage>
      ) : (
        <StatsBody stats={query.data} />
      )}
    </>
  );
}
