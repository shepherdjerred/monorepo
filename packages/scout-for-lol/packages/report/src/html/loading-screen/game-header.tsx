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
        width: "36px",
        height: "36px",
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
            fontSize: "24px",
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

function BansRow({ bans, team }: { bans: LoadingScreenBan[]; team: "blue" | "red" }) {
  const teamBans = bans.filter((b) => b.team === team);
  if (teamBans.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "flex", gap: "4px" }}>
      {teamBans.map((ban, idx) => (
        <BanIcon key={`${ban.championId.toString()}-${idx.toString()}`} ban={ban} />
      ))}
    </div>
  );
}

export function GameHeader({ data }: { data: LoadingScreenData }) {
  const hasBans = data.bans.length > 0;

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
      {/* Mode label + ranked badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <span
          style={{
            fontSize: "28px",
            fontFamily: font.title,
            fontWeight: 700,
            color: palette.gold[2],
            textTransform: "uppercase",
            letterSpacing: "2px",
          }}
        >
          {data.queueDisplayName}
        </span>

        {data.isRanked && (
          <div
            style={{
              display: "flex",
              backgroundColor: palette.gold[6],
              border: `1px solid ${palette.gold[4]}`,
              borderRadius: "4px",
              padding: "2px 10px",
            }}
          >
            <span
              style={{
                fontSize: "14px",
                fontFamily: font.body,
                fontWeight: 700,
                color: palette.gold.bright,
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              Ranked
            </span>
          </div>
        )}
      </div>

      {/* Map name */}
      <span
        style={{
          fontSize: "14px",
          fontFamily: font.body,
          color: palette.grey[1],
          letterSpacing: "1px",
        }}
      >
        {data.mapName}
      </span>

      {/* Bans row */}
      {hasBans && (
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
      )}
    </div>
  );
}
