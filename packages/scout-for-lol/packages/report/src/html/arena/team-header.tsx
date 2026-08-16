import { type ArenaTeam, getArenaTeamName } from "@scout-for-lol/data";
import { palette } from "@scout-for-lol/design-system/satori/colors";
import { font } from "@scout-for-lol/design-system/satori/fonts";
import { PlacementBadge } from "#src/html/arena/placement-badge.tsx";

export function TeamHeader({ team }: { team: ArenaTeam }) {
  const teamName = getArenaTeamName(team.teamId);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 28,
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
