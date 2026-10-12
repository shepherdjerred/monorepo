import IconTrophy from "~icons/ph/trophy-fill";
import type { DiscordUser } from "@discord-plays-mario-kart/common";
import { Avatar } from "#src/ui/avatar.tsx";
import { cx } from "#src/ui/cx.ts";
import { PanelError, PanelLoading, PanelMessage } from "./bits.tsx";
import { averagePlace, percent } from "./format.ts";
import { useLeaderboard } from "./queries.ts";

const RANK_STYLES: Record<number, string> = {
  1: "text-gold",
  2: "text-silver",
  3: "text-bronze",
};

export function LeaderboardPanel({
  meId,
  onSelect,
}: {
  meId: string | undefined;
  onSelect: (player: DiscordUser) => void;
}) {
  const query = useLeaderboard();
  if (query.isPending) {
    return <PanelLoading />;
  }
  if (query.isError) {
    return (
      <PanelError
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  if (query.data.length === 0) {
    return (
      <PanelMessage icon={<IconTrophy />} title="No ranked races yet">
        Finish a Grand Prix or VS race while signed in and the standings start
        here.
      </PanelMessage>
    );
  }
  return (
    <div>
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_2.5rem_3rem_2.5rem] items-center gap-2 px-3 pb-1.5 text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
        <span className="text-center">#</span>
        <span>Driver</span>
        <span className="text-right" title="Podium finishes (1st to 3rd)">
          Top 3
        </span>
        <span className="text-right">Win %</span>
        <span className="text-right" title="Average finishing place">
          Avg
        </span>
      </div>
      <ol className="space-y-1">
        {query.data.map((entry, index) => {
          const rank = index + 1;
          const isMe = entry.player.discordId === meId;
          return (
            <li key={entry.player.discordId}>
              <button
                type="button"
                onClick={() => {
                  onSelect(entry.player);
                }}
                className={cx(
                  "grid w-full grid-cols-[1.5rem_minmax(0,1fr)_2.5rem_3rem_2.5rem] items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.04]",
                  isMe && "bg-brand-soft ring-1 ring-brand/20",
                )}
              >
                <span
                  className={cx(
                    "text-center text-sm font-bold tabular-nums",
                    RANK_STYLES[rank] ?? "text-ink-faint",
                  )}
                >
                  {rank}
                </span>
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar
                    name={entry.player.name}
                    url={entry.player.avatarUrl}
                    seed={entry.player.discordId}
                    size="sm"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {entry.player.name}
                    </span>
                    <span className="block text-[11px] text-ink-faint tabular-nums">
                      {entry.wins}W · {entry.losses}L
                    </span>
                  </span>
                </span>
                <span className="text-right text-sm text-ink-muted tabular-nums">
                  {entry.podiums}
                </span>
                <span className="text-right text-sm font-semibold text-ink tabular-nums">
                  {percent(entry.winRate)}
                </span>
                <span className="text-right text-sm text-ink-muted tabular-nums">
                  {averagePlace(entry.averagePlacement)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
