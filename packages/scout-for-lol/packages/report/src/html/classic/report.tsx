import type { ClassicChampion, ClassicMatch, Team } from "@scout-for-lol/data";
import {
  championNameToDisplayName,
  getSummonerSpellImageNameById,
  queueTypeToDisplayString,
} from "@scout-for-lol/data";
import {
  getChampionImage,
  getChampionSplashImage,
  getItemImage,
  getSpellImage,
} from "#src/dataDragon/image-cache.ts";
import {
  classicPalette,
  classicTypography,
} from "#src/assets/classic-style.ts";
import { formatDuration } from "#src/html/shared/format.ts";

export const CLASSIC_MATCH_WIDTH = 1920;
export const CLASSIC_MATCH_BASE_HEIGHT = 520;
export const CLASSIC_MATCH_ROW_HEIGHT = 68;

const COLUMN_WIDTHS = {
  portrait: 64,
  level: 72,
  player: 462,
  kda: 190,
  spells: 120,
  items: 470,
  gold: 190,
  creepScore: 180,
} as const;

const COLUMN_GAP = 16;

export function classicMatchHeight(match: ClassicMatch): number {
  return (
    CLASSIC_MATCH_BASE_HEIGHT +
    CLASSIC_MATCH_ROW_HEIGHT *
      (match.teams.blue.length + match.teams.red.length)
  );
}

function teamPalette(team: Team) {
  return team === "blue" ? classicPalette.steel : classicPalette.red;
}

function ClassicSpell({ spellId }: { spellId: number }) {
  return (
    <img
      alt=""
      src={getSpellImage(getSummonerSpellImageNameById(spellId))}
      width={48}
      height={48}
      style={{
        width: 48,
        height: 48,
        border: `2px solid ${classicPalette.gold.shadow}`,
      }}
    />
  );
}

function ClassicItem({ itemId }: { itemId: number }) {
  if (itemId === 0) {
    return (
      <div
        style={{
          display: "flex",
          width: 56,
          height: 56,
          backgroundColor: classicPalette.canvas,
          border: `1px solid ${classicPalette.gold.shadow}`,
        }}
      />
    );
  }
  return (
    <img
      alt=""
      src={getItemImage(itemId)}
      width={56}
      height={56}
      style={{
        width: 56,
        height: 56,
        border: `1px solid ${classicPalette.gold.shadow}`,
      }}
    />
  );
}

function Column({
  width,
  children,
  justifyContent = "center",
}: {
  width: number;
  children: React.ReactNode;
  justifyContent?: "center" | "flex-start" | "flex-end";
}) {
  return (
    <div
      style={{
        display: "flex",
        width,
        height: "100%",
        flexShrink: 0,
        alignItems: "center",
        justifyContent,
      }}
    >
      {children}
    </div>
  );
}

function PlayerRow({
  champion,
  team,
  isTracked,
}: {
  champion: ClassicChampion;
  team: Team;
  isTracked: boolean;
}) {
  const colors = teamPalette(team);
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: CLASSIC_MATCH_ROW_HEIGHT,
        padding: "6px",
        gap: COLUMN_GAP,
        alignItems: "center",
        color: classicPalette.text.primary,
        backgroundColor: isTracked ? colors.deep : classicPalette.panel,
        borderBottom: `1px solid ${colors.accent}`,
        fontFamily: classicTypography.stack.body,
        fontSize: classicTypography.size.bodyMedium.fontSize,
        lineHeight: classicTypography.size.bodyMedium.lineHeight,
      }}
    >
      <Column width={COLUMN_WIDTHS.portrait}>
        <img
          alt=""
          src={getChampionImage(champion.championName)}
          width={56}
          height={56}
          style={{
            width: 56,
            height: 56,
            border: `2px solid ${isTracked ? classicPalette.gold.highlight : colors.accent}`,
          }}
        />
      </Column>
      <Column width={COLUMN_WIDTHS.level}>
        <span style={{ color: classicPalette.text.secondary }}>
          Lv {champion.level.toString()}
        </span>
      </Column>
      <Column width={COLUMN_WIDTHS.player} justifyContent="flex-start">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              color: isTracked
                ? classicPalette.gold.highlight
                : classicPalette.text.strong,
              fontWeight: 700,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {champion.riotIdGameName}#{champion.riotIdTagLine}
          </span>
          <span
            style={{
              color: classicPalette.text.secondary,
              fontSize: classicTypography.size.caption.fontSize,
              lineHeight: classicTypography.size.caption.lineHeight,
            }}
          >
            {championNameToDisplayName(champion.championName)}
          </span>
        </div>
      </Column>
      <Column width={COLUMN_WIDTHS.kda}>
        <span>
          {champion.kills.toString()} / {champion.deaths.toString()} /{" "}
          {champion.assists.toString()}
        </span>
      </Column>
      <Column width={COLUMN_WIDTHS.spells}>
        <div style={{ display: "flex", gap: 8 }}>
          {champion.spells.map((spellId, index) => (
            <ClassicSpell
              key={`${spellId.toString()}-${index.toString()}`}
              spellId={spellId}
            />
          ))}
        </div>
      </Column>
      <Column width={COLUMN_WIDTHS.items}>
        <div style={{ display: "flex", gap: 6 }}>
          {champion.items.map((itemId, index) => (
            <ClassicItem
              key={`${itemId.toString()}-${index.toString()}`}
              itemId={itemId}
            />
          ))}
        </div>
      </Column>
      <Column width={COLUMN_WIDTHS.gold}>
        <span style={{ color: classicPalette.gold.highlight }}>
          {champion.gold.toLocaleString("en-US")} gold
        </span>
      </Column>
      <Column width={COLUMN_WIDTHS.creepScore}>
        <span>{champion.creepScore.toLocaleString("en-US")} CS</span>
      </Column>
    </div>
  );
}

function TeamHeader({
  team,
  champions,
  trackedTeam,
  trackedOutcome,
}: {
  team: Team;
  champions: ClassicChampion[];
  trackedTeam: Team;
  trackedOutcome: ClassicMatch["players"][number]["outcome"];
}) {
  const colors = teamPalette(team);
  const kills = champions.reduce(
    (total, champion) => total + champion.kills,
    0,
  );
  const gold = champions.reduce((total, champion) => total + champion.gold, 0);
  const trackedWon = trackedOutcome === "Victory";
  const teamWon = team === trackedTeam ? trackedWon : !trackedWon;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      <div
        style={{
          display: "flex",
          width: "100%",
          height: 44,
          padding: "0 20px",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: colors.deep,
          borderTop: `2px solid ${colors.accent}`,
          borderBottom: `2px solid ${colors.accent}`,
          color: colors.highlight,
          fontFamily: classicTypography.stack.display,
          fontSize: classicTypography.size.medium.fontSize,
          lineHeight: classicTypography.size.medium.lineHeight,
          fontWeight: 700,
        }}
      >
        <span>{team === "blue" ? "BLUE TEAM" : "RED TEAM"}</span>
        <span style={{ color: classicPalette.gold.highlight }}>
          {teamWon ? "VICTORY" : "DEFEAT"} · {kills.toString()} KILLS ·{" "}
          {gold.toLocaleString("en-US")} GOLD
        </span>
      </div>
      <div
        style={{
          display: "flex",
          width: "100%",
          height: 36,
          padding: "0 6px",
          gap: COLUMN_GAP,
          alignItems: "center",
          backgroundColor: classicPalette.raised,
          color: classicPalette.text.secondary,
          fontFamily: classicTypography.stack.body,
          fontSize: classicTypography.size.caption.fontSize,
          lineHeight: classicTypography.size.caption.lineHeight,
          fontWeight: 700,
        }}
      >
        <Column width={COLUMN_WIDTHS.portrait}>CHAMPION</Column>
        <Column width={COLUMN_WIDTHS.level}>LEVEL</Column>
        <Column width={COLUMN_WIDTHS.player} justifyContent="flex-start">
          SUMMONER
        </Column>
        <Column width={COLUMN_WIDTHS.kda}>K / D / A</Column>
        <Column width={COLUMN_WIDTHS.spells}>SPELLS</Column>
        <Column width={COLUMN_WIDTHS.items}>ITEMS</Column>
        <Column width={COLUMN_WIDTHS.gold}>GOLD</Column>
        <Column width={COLUMN_WIDTHS.creepScore}>MINIONS</Column>
      </div>
    </div>
  );
}

function TeamTable({
  team,
  champions,
  trackedPuuids,
  trackedTeam,
  trackedOutcome,
}: {
  team: Team;
  champions: ClassicChampion[];
  trackedPuuids: ReadonlySet<string>;
  trackedTeam: Team;
  trackedOutcome: ClassicMatch["players"][number]["outcome"];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      <TeamHeader
        team={team}
        champions={champions}
        trackedTeam={trackedTeam}
        trackedOutcome={trackedOutcome}
      />
      {champions.map((champion) => (
        <PlayerRow
          key={champion.puuid}
          champion={champion}
          team={team}
          isTracked={trackedPuuids.has(champion.puuid)}
        />
      ))}
    </div>
  );
}

export function ClassicMatchReport({ match }: { match: ClassicMatch }) {
  const hero = match.players[0];
  if (hero === undefined) {
    throw new Error("Classic match requires at least one tracked player");
  }
  const trackedPuuids = new Set(
    match.players.map((player) => player.champion.puuid),
  );
  const outcomeColor =
    hero.outcome === "Victory"
      ? classicPalette.gold.highlight
      : classicPalette.red.highlight;
  const queueLabel = queueTypeToDisplayString(match.queueType).toUpperCase();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "20px 24px",
        gap: 10,
        backgroundColor: classicPalette.canvas,
      }}
    >
      <div
        style={{
          display: "flex",
          position: "relative",
          width: "100%",
          height: 300,
          flexShrink: 0,
          overflow: "hidden",
          backgroundColor: classicPalette.canvas,
          border: `2px solid ${classicPalette.gold.shadow}`,
        }}
      >
        <img
          alt=""
          src={getChampionSplashImage(hero.champion.championName)}
          width={1872}
          height={300}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1872,
            height: 300,
            objectFit: "cover",
          }}
        />
        <div
          style={{
            display: "flex",
            position: "absolute",
            top: 0,
            left: 0,
            width: 1872,
            height: 300,
            background:
              "linear-gradient(90deg, rgba(5, 13, 23, 0.1), rgba(5, 13, 23, 0.92) 70%)",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            position: "absolute",
            right: 52,
            top: 42,
            alignItems: "flex-end",
            color: classicPalette.text.strong,
          }}
        >
          <span
            style={{
              color: outcomeColor,
              fontFamily: classicTypography.stack.display,
              fontSize: classicTypography.size.xl.fontSize,
              lineHeight: classicTypography.size.xl.lineHeight,
              fontWeight: 700,
            }}
          >
            {hero.outcome.toUpperCase()}
          </span>
          <span
            style={{
              marginTop: 12,
              fontFamily: classicTypography.stack.display,
              fontSize: classicTypography.size.large.fontSize,
              lineHeight: classicTypography.size.large.lineHeight,
            }}
          >
            {queueLabel}
          </span>
          <span
            style={{
              marginTop: 10,
              color: classicPalette.text.secondary,
              fontFamily: classicTypography.stack.body,
              fontSize: classicTypography.size.bodyLarge.fontSize,
              lineHeight: classicTypography.size.bodyLarge.lineHeight,
            }}
          >
            {match.mapName} · {formatDuration(match.durationInSeconds)}
          </span>
        </div>
      </div>
      <TeamTable
        team="blue"
        champions={match.teams.blue}
        trackedPuuids={trackedPuuids}
        trackedTeam={hero.team}
        trackedOutcome={hero.outcome}
      />
      <TeamTable
        team="red"
        champions={match.teams.red}
        trackedPuuids={trackedPuuids}
        trackedTeam={hero.team}
        trackedOutcome={hero.outcome}
      />
    </div>
  );
}
