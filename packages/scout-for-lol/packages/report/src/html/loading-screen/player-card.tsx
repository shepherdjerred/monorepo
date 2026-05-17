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

type PlayerCardVariant = "standard" | "compact";

type PlayerCardSizing = {
  width: number;
  height: number;
  iconSize: number;
  runeSize: number;
  championFontSize: number;
  playerFontSize: number;
  rankFontSize: number;
  overlayPadding: number;
  overlayTopPadding: number;
};

const PLAYER_CARD_SIZING: Record<PlayerCardVariant, PlayerCardSizing> = {
  standard: {
    width: 280,
    height: 480,
    iconSize: 34,
    runeSize: 38,
    championFontSize: 13,
    playerFontSize: 18,
    rankFontSize: 12,
    overlayPadding: 10,
    overlayTopPadding: 32,
  },
  compact: {
    width: 210,
    height: 360,
    iconSize: 26,
    runeSize: 30,
    championFontSize: 11,
    playerFontSize: 15,
    rankFontSize: 10,
    overlayPadding: 8,
    overlayTopPadding: 26,
  },
};

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function resolveSpellImage(spellId: number): string | undefined {
  const name = first(
    keys(pickBy(summoner.data, (spell) => spell.key === spellId.toString())),
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
  iconSize,
}: {
  spell1Id: number;
  spell2Id: number;
  iconSize: number;
}) {
  const spell1Img = resolveSpellImage(spell1Id);
  const spell2Img = resolveSpellImage(spell2Id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      {spell1Img !== undefined && (
        <img
          src={spell1Img}
          alt=""
          style={{
            width: `${iconSize.toString()}px`,
            height: `${iconSize.toString()}px`,
            borderRadius: "2px",
            border: `1px solid ${palette.gold[5]}`,
          }}
        />
      )}
      {spell2Img !== undefined && (
        <img
          src={spell2Img}
          alt=""
          style={{
            width: `${iconSize.toString()}px`,
            height: `${iconSize.toString()}px`,
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
  runeSize,
}: {
  keystoneRuneId: number | undefined;
  secondaryTreeId: number | undefined;
  runeSize: number;
}) {
  const keystoneInfo =
    keystoneRuneId === undefined ? undefined : getRuneInfo(keystoneRuneId);
  const secondaryInfo =
    secondaryTreeId === undefined
      ? undefined
      : getRuneTreeInfo(secondaryTreeId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      {keystoneInfo && (
        <img
          src={getRuneIconUrl(keystoneInfo.icon)}
          alt=""
          style={{
            width: `${runeSize.toString()}px`,
            height: `${runeSize.toString()}px`,
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
            width: `${(runeSize - 8).toString()}px`,
            height: `${(runeSize - 8).toString()}px`,
            borderRadius: "50%",
            backgroundColor: "rgba(0, 0, 0, 0.4)",
          }}
        />
      )}
    </div>
  );
}

export function PlayerCard({
  participant,
  teamSide,
  variant = "standard",
}: {
  participant: LoadingScreenParticipant;
  teamSide: "blue" | "red" | "neutral";
  variant?: PlayerCardVariant;
}) {
  const sizing = PLAYER_CARD_SIZING[variant];
  const splashArt = getChampionLoadingImage(
    participant.championName,
    participant.skinNum,
  );

  const borderColor = participant.isTrackedPlayer
    ? palette.gold.bright
    : teamSide === "blue"
      ? palette.teams.blue
      : teamSide === "red"
        ? palette.teams.red
        : palette.grey[2];

  const borderWidth = participant.isTrackedPlayer ? "3px" : "2px";

  const rank = participant.ranks?.solo ?? participant.ranks?.flex;
  const rankText =
    rank === undefined
      ? "Unranked"
      : `${capitalize(rank.tier)} ${divisionToString(rank.division)}`;

  return (
    <div
      style={{
        width: `${sizing.width.toString()}px`,
        height: `${sizing.height.toString()}px`,
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

      {/* Bottom overlay with all player info */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          padding: `${sizing.overlayPadding.toString()}px`,
          paddingTop: `${sizing.overlayTopPadding.toString()}px`,
          background: "linear-gradient(transparent, rgba(0, 0, 0, 0.85) 30%)",
        }}
      >
        {/* Runes/spells row with name + rank in center */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            width: "100%",
          }}
        >
          <RuneIcons
            keystoneRuneId={participant.keystoneRuneId}
            secondaryTreeId={participant.secondaryTreeId}
            runeSize={sizing.runeSize}
          />

          {/* Center: champion name, summoner name, rank */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              flex: 1,
              marginLeft: "6px",
              marginRight: "6px",
              overflow: "hidden",
            }}
          >
            {/* Champion name */}
            <span
              style={{
                fontSize: `${sizing.championFontSize.toString()}px`,
                fontFamily: font.body,
                fontWeight: 400,
                color: palette.grey[1],
                textShadow: "0 1px 3px rgba(0,0,0,0.9)",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              {participant.championDisplayName}
            </span>

            {/* Summoner name */}
            <span
              style={{
                fontSize: `${sizing.playerFontSize.toString()}px`,
                fontFamily: font.title,
                fontWeight: 700,
                color: participant.isTrackedPlayer
                  ? palette.gold.bright
                  : palette.gold[1],
                textShadow: "0 1px 3px rgba(0,0,0,0.9)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "100%",
              }}
            >
              {participant.summonerName}
            </span>

            {/* Rank tier text */}
            <span
              style={{
                fontSize: `${sizing.rankFontSize.toString()}px`,
                fontFamily: font.body,
                fontWeight: 700,
                color: palette.gold[3],
                textShadow: "0 1px 2px rgba(0,0,0,0.9)",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              {rankText}
            </span>
          </div>

          <SummonerSpells
            spell1Id={participant.spell1Id}
            spell2Id={participant.spell2Id}
            iconSize={sizing.iconSize}
          />
        </div>
      </div>
    </div>
  );
}
