import type { ArenaLoadingScreenData } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { PlayerCard } from "#src/html/loading-screen/player-card.tsx";

export function getArenaTrackedParticipants(data: ArenaLoadingScreenData) {
  return data.participants.filter((participant) => participant.isTrackedPlayer);
}

export function ArenaLayout({ data }: { data: ArenaLoadingScreenData }) {
  const trackedParticipants = getArenaTrackedParticipants(data);
  const cardVariant = trackedParticipants.length > 3 ? "compact" : "standard";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "100%",
      }}
    >
      {trackedParticipants.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "18px",
            justifyContent: "center",
            maxWidth: "1320px",
          }}
        >
          {trackedParticipants.map((participant) => (
            <PlayerCard
              key={participant.puuid ?? participant.summonerName}
              participant={participant}
              teamSide="neutral"
              variant={cardVariant}
            />
          ))}
        </div>
      ) : (
        <span
          style={{
            fontSize: "22px",
            fontFamily: font.body,
            color: palette.grey[1],
          }}
        >
          No champions found
        </span>
      )}
    </div>
  );
}
