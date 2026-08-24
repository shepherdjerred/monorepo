import {
  LANE_ORDER,
  type AramLoadingScreenData,
  type QueueType,
  type StandardLoadingScreenData,
} from "@scout-for-lol/data";
import { palette } from "@scout-for-lol/design-system/satori/colors";
import { font } from "@scout-for-lol/design-system/satori/fonts";
import { PlayerCard } from "#src/html/loading-screen/player-card.tsx";

function TeamRow({
  participants,
  teamSide,
  label,
  queueType,
}: {
  participants:
    | StandardLoadingScreenData["participants"]
    | AramLoadingScreenData["participants"];
  teamSide: "blue" | "red";
  label: string;
  queueType?: QueueType;
}) {
  const teamColor =
    teamSide === "blue" ? palette.teams.blue : palette.teams.red;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <span
        style={{
          fontSize: "14px",
          fontFamily: font.title,
          fontWeight: 700,
          color: teamColor,
          textTransform: "uppercase",
          letterSpacing: "2px",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: "8px" }}>
        {participants.map((participant) => (
          <PlayerCard
            key={participant.puuid ?? participant.summonerName}
            participant={participant}
            teamSide={teamSide}
            queueType={queueType}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A laneless player (a sub-five custom side, where Riot assigns no role) sorts
 * last rather than first: `indexOf` returns -1 for undefined, which would
 * otherwise float them above top lane.
 */
function laneRank(lane: (typeof LANE_ORDER)[number] | undefined): number {
  return lane === undefined ? LANE_ORDER.length : LANE_ORDER.indexOf(lane);
}

function roleOrderedParticipants(
  data: StandardLoadingScreenData,
  teamSide: "blue" | "red",
): StandardLoadingScreenData["participants"] {
  return data.participants
    .filter((participant) => participant.team === teamSide)
    .toSorted((left, right) => laneRank(left.lane) - laneRank(right.lane));
}

export function StandardLayout({
  data,
}: {
  data: StandardLoadingScreenData | AramLoadingScreenData;
}) {
  const blueTeam =
    data.layout === "standard"
      ? roleOrderedParticipants(data, "blue")
      : data.participants.filter((p) => p.team === "blue");
  const redTeam =
    data.layout === "standard"
      ? roleOrderedParticipants(data, "red")
      : data.participants.filter((p) => p.team === "red");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "24px",
        width: "100%",
      }}
    >
      <TeamRow
        participants={blueTeam}
        teamSide="blue"
        label="Blue Team"
        queueType={data.queueType}
      />

      {/* VS divider */}
      <span
        style={{
          fontSize: "36px",
          fontFamily: font.title,
          fontWeight: 800,
          color: palette.gold[4],
          textShadow: `0 0 20px ${palette.gold[4]}40`,
        }}
      >
        VS
      </span>

      <TeamRow
        participants={redTeam}
        teamSide="red"
        label="Red Team"
        queueType={data.queueType}
      />
    </div>
  );
}
