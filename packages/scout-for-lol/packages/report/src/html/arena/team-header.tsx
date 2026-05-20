import { type ArenaTeam, getArenaTeamName } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { PlacementBadge } from "#src/html/arena/placement-badge.tsx";

export function TeamHeader({ team }: { team: ArenaTeam }) {
  const teamName = getArenaTeamName(team.teamId);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
      }}
    >
      <PlacementBadge placement={team.placement} />
      <span
        style={{
          fontFamily: font.title,
          fontSize: 28,
          fontWeight: 500,
          color: palette.gold[3],
          letterSpacing: 10,
          textTransform: "uppercase",
        }}
      >
        Team {teamName}
      </span>
    </div>
  );
}
