import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ChampionCard } from "./champion-card.tsx";
import { FriendRow, latestLine } from "./friend-row.tsx";
import { gamesLabel } from "./format.ts";
import {
  formatLpChange,
  GameSentenceRow,
  gameSentence,
} from "./game-sentence-row.tsx";
import { SetupRow } from "./setup-row.tsx";
import { Sticker } from "./sticker.tsx";
import { TipList } from "./tip-list.tsx";

describe("latestLine", () => {
  test("leads with the live state and keeps the rest of the sentence", () => {
    expect(latestLine({ live: true, latest: "as Ahri" })).toBe(
      "In a game now, as Ahri",
    );
    expect(latestLine({ live: true, latest: undefined })).toBe("In a game now");
  });

  test("passes the latest game through when nobody is live", () => {
    expect(
      latestLine({ live: false, latest: "Won as Garen, 2 days ago" }),
    ).toBe("Won as Garen, 2 days ago");
    expect(latestLine({ live: false, latest: undefined })).toBeUndefined();
  });
});

describe("FriendRow", () => {
  test("renders a link with the name, rank and latest game", () => {
    const html = renderToStaticMarkup(
      <FriendRow
        name="TidalWren"
        href="#tidal"
        latest="Lost as Thresh, 2 hours ago"
        rank={{ rank: "Platinum", division: "I", leaguePoints: 80 }}
      />,
    );
    expect(html).toContain('<a class="scout-friend-row"');
    expect(html).toContain('href="#tidal"');
    expect(html).toContain('title="TidalWren"');
    expect(html).toContain("Lost as Thresh, 2 hours ago");
    expect(html).toContain("Platinum I");
    expect(html).toContain("80 LP");
    expect(html).toContain('data-layout="list"');
  });

  test("uses the ladder layout with a place and marks the viewer", () => {
    const html = renderToStaticMarkup(
      <FriendRow
        name="Northstar"
        you
        place={2}
        rank={{ rank: "Emerald", division: "II", leaguePoints: 64 }}
      />,
    );
    expect(html).toContain('data-layout="ladder"');
    expect(html).toContain(">2</span>");
    expect(html).toContain(">You</span>");
    expect(html).toContain('data-you="true"');
    expect(html.startsWith("<div")).toBe(true);
  });

  test("shows a live dot and says so, and handles no rank", () => {
    const html = renderToStaticMarkup(
      <FriendRow name="RiverQuartz" live latest="as Ahri" />,
    );
    expect(html).toContain("In a game now, as Ahri");
    expect(html).toContain("scout-person__live");
    expect(html).toContain("Unranked");
  });
});

describe("game sentences", () => {
  test("formats LP with a true minus sign", () => {
    expect(formatLpChange(21)).toBe("+21 LP");
    expect(formatLpChange(-18)).toBe("−18 LP");
    expect(formatLpChange(0)).toBe("0 LP");
  });

  test("builds the viewer's own sentence", () => {
    expect(
      gameSentence({
        result: "win",
        championName: "Ahri",
        kda: { kills: 9, deaths: 2, assists: 11 },
        lpChange: 21,
      }),
    ).toEqual({ lead: "Won", rest: " as Ahri, 9/2/11, +21 LP" });
    expect(gameSentence({ result: "loss", championName: "Orianna" })).toEqual({
      lead: "Lost",
      rest: " as Orianna",
    });
  });

  test("builds a friend's sentence with a suffix before the score", () => {
    expect(
      gameSentence({
        result: "win",
        championName: "Jinx",
        person: "RiverQuartz",
        suffix: "with you",
        kda: { kills: 10, deaths: 3, assists: 9 },
      }),
    ).toEqual({ lead: "RiverQuartz", rest: " won as Jinx with you, 10/3/9" });
  });

  test("renders the face with its result, the sentence and the time", () => {
    const html = renderToStaticMarkup(
      <GameSentenceRow
        result="loss"
        champion="Orianna"
        kda={{ kills: 3, deaths: 6, assists: 8 }}
        lpChange={-18}
        when="Yesterday"
        detail="Ranked Solo"
        href="#g"
      />,
    );
    expect(html).toContain("<b");
    expect(html).toContain("Lost</b> as Orianna, 3/6/8, −18 LP");
    expect(html).toContain('data-result="loss"');
    expect(html).toContain("Yesterday");
    expect(html).toContain("Ranked Solo");
  });

  test("uses the person's initial with a champion badge in a feed", () => {
    const html = renderToStaticMarkup(
      <GameSentenceRow
        result="win"
        champion="Jinx"
        person="RiverQuartz"
        suffix="with you"
        highlight="Quadra kill"
      />,
    );
    expect(html).toContain("scout-person__badge");
    expect(html).not.toContain("scout-face__mark");
    expect(html).toContain('title="RiverQuartz"');
    expect(html).toContain("Quadra kill");
  });
});

describe("Sticker", () => {
  test("shows the award, who got it and the spark", () => {
    const html = renderToStaticMarkup(
      <Sticker
        title="Biggest climb"
        detail="Northstar, +63 LP"
        who={{ person: "Northstar", you: true }}
        href="#a"
      />,
    );
    expect(html).toContain("<b>Biggest climb</b>");
    expect(html).toContain("Northstar, +63 LP");
    expect(html).toContain("scout-sticker__mark");
    expect(html).toContain('data-you="true"');
  });

  test("takes a champion instead of a person", () => {
    const html = renderToStaticMarkup(
      <Sticker
        title="Most played"
        detail="Yasuo, 14 games"
        who={{ champion: "Yasuo" }}
      />,
    );
    expect(html).toContain("scout-face");
    expect(html.startsWith("<div")).toBe(true);
  });
});

describe("SetupRow", () => {
  test("formats games and shows the win rate and pick rate", () => {
    expect(gamesLabel(7840)).toBe("7,840 games");
    expect(gamesLabel(1)).toBe("1 game");
    const html = renderToStaticMarkup(
      <SetupRow
        title="Summoner spells"
        items={[
          { label: "Flash", asset: { kind: "spell", key: "SummonerFlash" } },
          { label: "Ignite", asset: { kind: "spell", key: "SummonerDot" } },
        ]}
        proof={{ winRate: 52.1, games: 9900, pickRate: 61.4 }}
      />,
    );
    expect(html).toContain("<b>52.1%</b> wins");
    expect(html).toContain("from 9,900 games");
    expect(html).toContain("Picked 61.4%");
    expect(html).toContain("<ul");
  });

  test("shows a rate with a zero decimal as 52.0%", () => {
    const html = renderToStaticMarkup(
      <SetupRow
        title="Starting items"
        items={[{ label: "Doran's Ring", asset: { kind: "item", key: 1056 } }]}
        proof={{ winRate: 52, games: 11_300, pickRate: 60 }}
      />,
    );
    expect(html).toContain("<b>52.0%</b> wins");
    expect(html).toContain("Picked 60.0%");
  });

  test("puts a chevron between items in a sequence and an ordered list", () => {
    const html = renderToStaticMarkup(
      <SetupRow
        title="Core build"
        sequence
        items={[
          { label: "Malignance", asset: { kind: "item", key: 3118 } },
          { label: "Shadowflame", asset: { kind: "item", key: 4645 } },
          { label: "Rabadon's", asset: { kind: "item", key: 3089 } },
        ]}
      />,
    );
    expect(html).toContain("<ol");
    expect(html.match(/scout-setup-row__then/g)).toHaveLength(2);
    expect(html).not.toContain("scout-setup-row__proof");
  });

  test("breaks the line where asked and marks the keystone", () => {
    const html = renderToStaticMarkup(
      <SetupRow
        title="Runes"
        note="Domination, with Sorcery second"
        items={[
          {
            label: "Electrocute",
            asset: { kind: "rune", key: "Electrocute" },
            keystone: true,
            breakAfter: true,
          },
          { label: "Cheap Shot", asset: { kind: "rune", key: "CheapShot" } },
        ]}
      />,
    );
    expect(html).toContain("scout-setup-row__break");
    expect(html).toContain('data-keystone="true"');
    expect(html).toContain("Domination, with Sorcery second");
  });
});

describe("TipList", () => {
  const tip = {
    id: "q",
    text: "Give up a minion rather than take a free Dark Sphere.",
    icons: [
      { asset: { kind: "ability", key: "Syndra-Q" }, label: "Dark Sphere" },
    ],
  } as const;

  test("leads each tip with its ability icons, named for assistive technology", () => {
    const html = renderToStaticMarkup(<TipList tips={[tip]} />);
    expect(html).toContain('alt="Dark Sphere"');
    expect(html).toContain(tip.text);
    expect(html).not.toContain("<details");
  });

  test("keeps the other side closed, showing its first tip", () => {
    const html = renderToStaticMarkup(
      <TipList
        tips={[tip]}
        reverse={{
          title: "Playing Syndra into Ahri",
          champion: "Syndra",
          tips: [{ id: "r", text: "Poke with Dark Sphere." }],
        }}
      />,
    );
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Playing Syndra into Ahri");
    expect(html).toContain("“Poke with Dark Sphere.”");
  });

  test("renders an empty list without a disclosure", () => {
    const html = renderToStaticMarkup(<TipList tips={[]} />);
    expect(html).not.toContain("<li");
    expect(html).not.toContain("<details");
  });
});

describe("ChampionCard", () => {
  test("shows the win rate, games, lane and tier", () => {
    const html = renderToStaticMarkup(
      <ChampionCard
        champion="Jinx"
        href="#jinx"
        lane={{ label: "Bot", icon: "adc" }}
        winRate={52.9}
        games={9840}
        laneWinRate={53.8}
        laneGames={1970}
        tier="S tier"
      />,
    );
    expect(html).toContain('href="#jinx"');
    expect(html).toContain("<b>52.9%</b> wins");
    expect(html).toContain("from 9,840 games");
    expect(html).toContain("Wins lane 53.8%");
    expect(html).toContain("from 1,970");
    expect(html).toContain("S tier");
    expect(html).toContain("Bot");
  });

  test("shows a win rate and a lane win rate with one decimal", () => {
    const html = renderToStaticMarkup(
      <ChampionCard
        champion="Garen"
        href="#garen"
        winRate={50}
        games={8120}
        laneWinRate={52}
        laneGames={1000}
      />,
    );
    expect(html).toContain("<b>50.0%</b> wins");
    expect(html).toContain("Wins lane 52.0%");
  });

  test("leaves out the lane and tier when they are not known", () => {
    const html = renderToStaticMarkup(
      <ChampionCard
        champion="Ahri"
        href="#ahri"
        winRate={51.8}
        games={12_480}
      />,
    );
    expect(html).not.toContain("scout-champion-card__lane-line");
    expect(html).not.toContain("scout-champion-card__tier");
  });

  test("leaves out the win rate and games when they are not given", () => {
    const html = renderToStaticMarkup(
      <ChampionCard
        champion="Jinx"
        href="#jinx"
        lane={{ label: "Bot", icon: "adc" }}
        tier="S tier"
      />,
    );
    expect(html).toContain('href="#jinx"');
    expect(html).toContain("Bot");
    expect(html).toContain("S tier");
    expect(html).not.toContain("scout-champion-card__win");
    expect(html).not.toContain("scout-champion-card__from");
    expect(html).not.toContain("wins");
    expect(html).not.toContain("games");
  });
});
