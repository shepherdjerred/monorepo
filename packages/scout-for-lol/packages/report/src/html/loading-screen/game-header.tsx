import type { LoadingScreenBan, LoadingScreenData } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { getChampionImage } from "#src/dataDragon/image-cache.ts";

function BanIcon({ ban }: { ban: LoadingScreenBan }) {
  let champImage: string | undefined;
  try {
    champImage = getChampionImage(ban.championName);
  } catch {
    // Champion image not in cache — skip
  }

  const teamColor =
    ban.team === "blue" ? palette.teams.blue : palette.teams.red;

  return (
    <div
      style={{
        width: "48px",
        height: "48px",
        display: "flex",
        position: "relative",
        borderRadius: "4px",
        overflow: "hidden",
        border: `1px solid ${teamColor}`,
        opacity: 0.7,
      }}
    >
      {champImage !== undefined && champImage.length > 0 ? (
        <img
          src={champImage}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "grayscale(60%)",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: palette.grey[4],
            display: "flex",
          }}
        />
      )}

      {/* Red X overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontSize: "32px",
            color: "#ff3333",
            fontWeight: 900,
            textShadow: "0 0 4px rgba(0,0,0,0.8)",
          }}
        >
          X
        </span>
      </div>
    </div>
  );
}

const BANS_PER_TEAM = 5;

function EmptyBanSlot({ team }: { team: "blue" | "red" }) {
  const teamColor = team === "blue" ? palette.teams.blue : palette.teams.red;

  return (
    <div
      style={{
        width: "48px",
        height: "48px",
        display: "flex",
        borderRadius: "4px",
        overflow: "hidden",
        border: `1px solid ${teamColor}`,
        opacity: 0.4,
        backgroundColor: palette.grey[5],
      }}
    />
  );
}

function BansRow({
  bans,
  team,
}: {
  bans: LoadingScreenBan[];
  team: "blue" | "red";
}) {
  const teamBans = bans.filter((b) => b.team === team);
  const emptySlots = BANS_PER_TEAM - teamBans.length;

  return (
    <div style={{ display: "flex", gap: "4px" }}>
      {teamBans.map((ban, idx) => (
        <BanIcon
          key={`${ban.championId.toString()}-${idx.toString()}`}
          ban={ban}
        />
      ))}
      {Array.from({ length: emptySlots }, (_, idx) => (
        <EmptyBanSlot key={`empty-${team}-${idx.toString()}`} team={team} />
      ))}
    </div>
  );
}

export function GameHeader({ data }: { data: LoadingScreenData }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "12px",
        marginBottom: "16px",
      }}
    >
      {/* Mode label */}
      <span
        style={{
          fontSize: "42px",
          fontFamily: font.title,
          fontWeight: 700,
          color: palette.gold[2],
          textTransform: "uppercase",
          letterSpacing: "2px",
        }}
      >
        {data.queueDisplayName}
      </span>

      {/* Bans row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <BansRow bans={data.bans} team="blue" />
        <span
          style={{
            fontSize: "12px",
            fontFamily: font.body,
            color: palette.grey[2],
            textTransform: "uppercase",
          }}
        >
          Bans
        </span>
        <BansRow bans={data.bans} team="red" />
      </div>
    </div>
  );
}
