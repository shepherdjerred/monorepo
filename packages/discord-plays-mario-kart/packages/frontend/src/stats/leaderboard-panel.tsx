import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";
import { Avatar } from "#src/ui/avatar.tsx";
import { cx } from "#src/ui/cx.ts";
import { Placement } from "#src/ui/mk.tsx";
import { PanelQueryError, PanelLoading, PanelMessage } from "./bits.tsx";
import { averagePlace, percent } from "./format.ts";
import { useLeaderboard } from "./queries.ts";

// The podium rows carry their medal colour as a wash from the left, like the
// game's results board.
const PODIUM_ROWS: Record<number, string> = {
  1: "bg-[linear-gradient(90deg,rgb(255_210_63/0.28),rgb(255_210_63/0)_75%)]",
  2: "bg-[linear-gradient(90deg,rgb(217_225_239/0.18),rgb(217_225_239/0)_75%)]",
  3: "bg-[linear-gradient(90deg,rgb(227_150_90/0.24),rgb(227_150_90/0)_75%)]",
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
    return <PanelQueryError error={query.error} refetch={query.refetch} />;
  }
  if (query.data.length === 0) {
    return (
      <PanelMessage title="No ranked races yet">
        Finish a Grand Prix or VS race while signed in and the standings start
        here.
      </PanelMessage>
    );
  }
  return (
    <div>
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.5rem_3rem_2.5rem] items-center gap-2 px-3 pb-1.5 text-[10px] font-semibold tracking-wider text-ink-muted uppercase">
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
                  "grid w-full grid-cols-[2.75rem_minmax(0,1fr)_2.5rem_3rem_2.5rem] items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.06]",
                  PODIUM_ROWS[rank],
                )}
              >
                <span className="flex justify-center">
                  <Placement
                    place={rank}
                    className={rank <= 3 ? "text-[22px]" : "text-base"}
                  />
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
                      {isMe ? (
                        <span className="ml-1.5 rounded bg-mk-red px-1 py-px text-[9px] font-bold tracking-wider text-white uppercase">
                          You
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-[11px] text-ink-muted tabular-nums">
                      {entry.wins}W · {entry.losses}L
                    </span>
                  </span>
                </span>
                <span className="text-right text-sm text-ink-muted tabular-nums">
                  {entry.podiums}
                </span>
                <span className="text-right font-display text-base text-white italic tabular-nums">
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
