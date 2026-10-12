import { useState } from "react";
import IconTrophy from "~icons/ph/trophy-fill";
import IconChart from "~icons/ph/chart-bar-fill";
import IconFlag from "~icons/ph/flag-checkered-fill";
import type { DiscordUser } from "@discord-plays-mario-kart/common";
import { Card } from "#src/ui/card.tsx";
import { Tabs, type TabItem } from "#src/ui/tabs.tsx";
import { LeaderboardPanel } from "./leaderboard-panel.tsx";
import { PlayerStatsPanel } from "./player-stats-panel.tsx";
import { useStatsPush } from "./queries.ts";
import { RecentRacesPanel } from "./recent-races-panel.tsx";

type Tab = "leaderboard" | "stats" | "races";

/** Leaderboard, a driver's stats, and recent races, in one tabbed card. */
export function StatsCard({
  me,
  onSignIn,
}: {
  me: DiscordUser | undefined;
  onSignIn: () => void;
}) {
  useStatsPush();
  const [tab, setTab] = useState<Tab>("leaderboard");
  const [picked, setPicked] = useState<DiscordUser>();
  const viewingOther =
    picked !== undefined && picked.discordId !== me?.discordId;
  const items: readonly TabItem<Tab>[] = [
    { id: "leaderboard", label: "Leaderboard", icon: <IconTrophy /> },
    {
      id: "stats",
      label: viewingOther ? "Driver" : "My stats",
      icon: <IconChart />,
    },
    { id: "races", label: "Races", icon: <IconFlag /> },
  ];
  return (
    <Card role="region" aria-label="Stats" className="flex flex-col">
      <div className="p-3 sm:p-4">
        <Tabs
          label="Stats"
          items={items}
          value={tab}
          onChange={(next) => {
            if (next === "stats" && tab !== "stats") {
              setPicked(undefined);
            }
            setTab(next);
          }}
        />
      </div>
      <div className="min-h-64 px-3 pb-4 sm:px-4">
        {tab === "leaderboard" ? (
          <LeaderboardPanel
            meId={me?.discordId}
            onSelect={(player) => {
              setPicked(player);
              setTab("stats");
            }}
          />
        ) : null}
        {tab === "stats" ? (
          <PlayerStatsPanel
            player={picked}
            me={me}
            onSignIn={onSignIn}
            onBack={
              viewingOther
                ? () => {
                    setPicked(undefined);
                    setTab("leaderboard");
                  }
                : undefined
            }
          />
        ) : null}
        {tab === "races" ? <RecentRacesPanel /> : null}
      </div>
    </Card>
  );
}
