import type {
  ClassicLoadingScreenData,
  ClassicLoadingScreenParticipant,
} from "@scout-for-lol/data";
import { getSummonerSpellImageNameById } from "@scout-for-lol/data";
import {
  getChampionLoadingImage,
  getSpellImage,
} from "#src/dataDragon/image-cache.ts";
import {
  classicPalette,
  classicTypography,
} from "#src/assets/classic-style.ts";

const CARD_WIDTH = 320;
const CARD_HEIGHT = 560;

function ClassicSpell({ spellId }: { spellId: number }) {
  const imageName = getSummonerSpellImageNameById(spellId);
  return (
    <img
      alt=""
      src={getSpellImage(imageName)}
      width={52}
      height={52}
      style={{
        width: 52,
        height: 52,
        border: `2px solid ${classicPalette.gold.shadow}`,
      }}
    />
  );
}

function ClassicCard({
  participant,
}: {
  participant: ClassicLoadingScreenParticipant;
}) {
  const team =
    participant.team === "blue" ? classicPalette.steel : classicPalette.red;
  const borderColor = participant.isTrackedPlayer
    ? classicPalette.gold.highlight
    : team.accent;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: CARD_WIDTH,
        minWidth: CARD_WIDTH,
        maxWidth: CARD_WIDTH,
        height: CARD_HEIGHT,
        flexShrink: 0,
        backgroundColor: classicPalette.panel,
        border: `4px solid ${borderColor}`,
        borderRadius: 6,
        overflow: "hidden",
        boxShadow: `0 0 0 2px ${team.deep}, 0 6px 18px rgba(0, 0, 0, 0.75)`,
      }}
    >
      <img
        alt=""
        src={getChampionLoadingImage(participant.championName)}
        width={312}
        height={420}
        style={{
          width: 312,
          height: 420,
          objectFit: "cover",
          objectPosition: "center top",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 38,
          width: "100%",
          padding: "0 10px",
          backgroundColor: team.deep,
          color: team.highlight,
          borderTop: `2px solid ${team.accent}`,
          fontFamily: classicTypography.stack.display,
          fontSize: 28,
          lineHeight: "32px",
          fontWeight: 700,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {participant.championDisplayName}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 34,
          width: "100%",
          padding: "0 12px",
          color: classicPalette.text.primary,
          backgroundColor: classicPalette.canvas,
          borderTop: `2px solid ${team.accent}`,
          fontFamily: classicTypography.stack.body,
          fontSize: 22,
          lineHeight: "28px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {participant.summonerName}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 68,
          width: "100%",
          padding: "6px 10px",
          backgroundColor: team.deep,
          borderTop: `2px solid ${team.accent}`,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <ClassicSpell spellId={participant.spell1Id} />
          <ClassicSpell spellId={participant.spell2Id} />
        </div>
        {participant.isTrackedPlayer && (
          <div
            style={{
              display: "flex",
              color: classicPalette.gold.highlight,
              fontFamily: classicTypography.stack.body,
              fontWeight: 700,
              fontSize: 16,
              lineHeight: "20px",
              letterSpacing: 1,
            }}
          >
            SCOUT
          </div>
        )}
      </div>
    </div>
  );
}

function ClassicTeamRow({
  participants,
}: {
  participants: ClassicLoadingScreenParticipant[];
}) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: CARD_HEIGHT,
        justifyContent: "center",
        gap: 16,
      }}
    >
      {participants.map((participant) => (
        <ClassicCard
          key={`${participant.team}-${participant.championId.toString()}-${participant.summonerName}`}
          participant={participant}
        />
      ))}
    </div>
  );
}

export function ClassicLoadingScreen({
  data,
  background,
}: {
  data: ClassicLoadingScreenData;
  background: string;
}) {
  const blue = data.participants.filter(
    (participant) => participant.team === "blue",
  );
  const red = data.participants.filter(
    (participant) => participant.team === "red",
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        position: "relative",
        width: "100%",
        height: "100%",
        padding: "16px 128px",
        justifyContent: "space-between",
        backgroundColor: classicPalette.canvas,
      }}
    >
      <img
        alt=""
        src={background}
        width={1920}
        height={1280}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 1920,
          height: 1280,
          objectFit: "cover",
        }}
      />
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 0,
          left: 0,
          width: 1920,
          height: 1280,
          background:
            "linear-gradient(rgba(5, 13, 23, 0.52), rgba(5, 13, 23, 0.72))",
        }}
      />
      <div style={{ display: "flex", position: "relative" }}>
        <ClassicTeamRow participants={blue} />
      </div>
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 576,
          left: 0,
          width: 1920,
          height: 128,
          alignItems: "center",
          justifyContent: "center",
          color: classicPalette.gold.highlight,
          fontFamily: classicTypography.stack.display,
          fontSize: 64,
          lineHeight: "64px",
          fontWeight: 700,
          textShadow: `0 3px 0 ${classicPalette.gold.shadow}`,
        }}
      >
        VS
      </div>
      <div style={{ display: "flex", position: "relative" }}>
        <ClassicTeamRow participants={red} />
      </div>
    </div>
  );
}
