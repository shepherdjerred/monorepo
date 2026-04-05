import type { LoadingScreenParticipant } from "@scout-for-lol/data";
import {
  getRuneInfo,
  getRuneTreeInfo,
  summoner,
  divisionToString,
} from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import {
  getChampionLoadingImage,
  getSpellImage,
} from "#src/dataDragon/image-cache.ts";
import { getRuneIconUrl } from "#src/dataDragon/runes.ts";
import { first, keys, pickBy } from "remeda";

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const CARD_WIDTH = 280;
const CARD_HEIGHT = 480;
const ICON_SIZE = 28;
const RUNE_SIZE = 32;

function resolveSpellImage(spellId: number): string | undefined {
  const name = first(
    keys(
      pickBy(summoner.data, (spell) => spell.key === spellId.toString()),
    ),
  );

  if (name === undefined) {
    return undefined;
  }

  const spellData = summoner.data[name];
  if (!spellData) {
    return undefined;
  }

  return getSpellImage(spellData.image.full);
}

function SummonerSpells({
  spell1Id,
  spell2Id,
}: {
  spell1Id: number;
  spell2Id: number;
}) {
  const spell1Img = resolveSpellImage(spell1Id);
  const spell2Img = resolveSpellImage(spell2Id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      {spell1Img && (
        <img
          src={spell1Img}
          alt=""
          style={{
            width: `${ICON_SIZE.toString()}px`,
            height: `${ICON_SIZE.toString()}px`,
            borderRadius: "2px",
            border: `1px solid ${palette.gold[5]}`,
          }}
        />
      )}
      {spell2Img && (
        <img
          src={spell2Img}
          alt=""
          style={{
            width: `${ICON_SIZE.toString()}px`,
            height: `${ICON_SIZE.toString()}px`,
            borderRadius: "2px",
            border: `1px solid ${palette.gold[5]}`,
          }}
        />
      )}
    </div>
  );
}

function RuneIcons({
  keystoneRuneId,
  secondaryTreeId,
}: {
  keystoneRuneId: number | undefined;
  secondaryTreeId: number | undefined;
}) {
  const keystoneInfo = keystoneRuneId
    ? getRuneInfo(keystoneRuneId)
    : undefined;
  const secondaryInfo = secondaryTreeId
    ? getRuneTreeInfo(secondaryTreeId)
    : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      {keystoneInfo && (
        <img
          src={getRuneIconUrl(keystoneInfo.icon)}
          alt=""
          style={{
            width: `${RUNE_SIZE.toString()}px`,
            height: `${RUNE_SIZE.toString()}px`,
            borderRadius: "50%",
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            border: `1px solid ${palette.gold[5]}`,
          }}
        />
      )}
      {secondaryInfo && (
        <img
          src={getRuneIconUrl(secondaryInfo.icon)}
          alt=""
          style={{
            width: `${(RUNE_SIZE - 6).toString()}px`,
            height: `${(RUNE_SIZE - 6).toString()}px`,
            borderRadius: "50%",
            backgroundColor: "rgba(0, 0, 0, 0.4)",
          }}
        />
      )}
    </div>
  );
}

function RankDisplay({ participant }: { participant: LoadingScreenParticipant }) {
  if (!participant.rank) {
    return null;
  }

  const { tier, division } = participant.rank;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        borderRadius: "4px",
        padding: "2px 6px",
        border: `1px solid ${palette.gold[5]}`,
      }}
    >
      <span
        style={{
          fontSize: "12px",
          fontFamily: font.body,
          fontWeight: 700,
          color: palette.gold[2],
        }}
      >
        {capitalize(tier)} {divisionToString(division)}
      </span>
    </div>
  );
}

export function PlayerCard({
  participant,
  teamSide,
}: {
  participant: LoadingScreenParticipant;
  teamSide: "blue" | "red" | "neutral";
}) {
  const splashArt = getChampionLoadingImage(
    participant.championName,
    participant.skinNum,
  );

  const borderColor =
    participant.isTrackedPlayer
      ? palette.gold.bright
      : teamSide === "blue"
        ? palette.teams.blue
        : teamSide === "red"
          ? palette.teams.red
          : palette.grey[2];

  const borderWidth = participant.isTrackedPlayer ? "3px" : "2px";

  return (
    <div
      style={{
        width: `${CARD_WIDTH.toString()}px`,
        height: `${CARD_HEIGHT.toString()}px`,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        borderRadius: "4px",
        border: `${borderWidth} solid ${borderColor}`,
      }}
    >
      {/* Champion splash art background */}
      <img
        src={splashArt}
        alt=""
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />

      {/* Tracked player glow effect */}
      {participant.isTrackedPlayer && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            boxShadow: `inset 0 0 20px ${palette.gold.bright}40`,
          }}
        />
      )}

      {/* Rank badge (top-right) */}
      <div
        style={{
          position: "absolute",
          top: "6px",
          right: "6px",
          display: "flex",
        }}
      >
        <RankDisplay participant={participant} />
      </div>

      {/* Bottom overlay with player info */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          padding: "8px",
          background:
            "linear-gradient(transparent, rgba(0, 0, 0, 0.85) 30%)",
        }}
      >
        {/* Summoner name */}
        <span
          style={{
            fontSize: "14px",
            fontFamily: font.title,
            fontWeight: 700,
            color: participant.isTrackedPlayer
              ? palette.gold.bright
              : palette.gold[1],
            textShadow: "0 1px 3px rgba(0,0,0,0.9)",
            marginBottom: "6px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {participant.summonerName}
        </span>

        {/* Runes and spells row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <RuneIcons
            keystoneRuneId={participant.keystoneRuneId}
            secondaryTreeId={participant.secondaryTreeId}
          />
          <SummonerSpells
            spell1Id={participant.spell1Id}
            spell2Id={participant.spell2Id}
          />
        </div>
      </div>
    </div>
  );
}
