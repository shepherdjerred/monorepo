import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ChampionFace } from "./champion-face.tsx";
import { DuelHero } from "./duel-hero.tsx";
import { isArtMirrored } from "./hero-art.tsx";
import { HeroPanel } from "./hero-panel.tsx";
import { NameText } from "./name-text.tsx";
import { initialOf, PersonInitial } from "./person-initial.tsx";
import { RankLockup } from "./rank-lockup.tsx";
import {
  currentStreak,
  ResultStrip,
  resultStripSummary,
  type GameResult,
} from "./result-strip.tsx";
import { formatPercent, trackPosition, WinRateBar } from "./win-rate-bar.tsx";

const win: GameResult = "win";
const loss: GameResult = "loss";

describe("currentStreak", () => {
  test("counts the run at the newest end", () => {
    expect(currentStreak([loss, win, win, win])).toEqual({
      result: "win",
      length: 3,
    });
    expect(currentStreak([win, win, loss, loss])).toEqual({
      result: "loss",
      length: 2,
    });
  });

  test("is a streak of one for a single game and absent for none", () => {
    expect(currentStreak([win])).toEqual({ result: "win", length: 1 });
    expect(currentStreak([])).toBeUndefined();
  });
});

describe("ResultStrip", () => {
  const twenty: GameResult[] = [
    loss,
    win,
    loss,
    win,
    loss,
    win,
    win,
    loss,
    win,
    loss,
    win,
    win,
    win,
    loss,
    loss,
    win,
    loss,
    win,
    win,
    win,
  ];

  test("summarises the games and the streak for assistive technology", () => {
    expect(resultStripSummary(twenty)).toBe(
      "The last 20 games, oldest first: loss, win, loss, win, loss, win, win, loss, win, loss, win, win, win, loss, loss, win, loss, win, win, win. Current streak: 3 wins.",
    );
    expect(resultStripSummary([])).toBe("No games yet.");
    expect(resultStripSummary([win])).toBe(
      "The last 1 game, oldest first: win.",
    );
  });

  test("draws one dot per slot and wraps only the streak", () => {
    const html = renderToStaticMarkup(<ResultStrip results={twenty} />);
    expect(html.match(/<i /g)).toHaveLength(20);
    const streak =
      /<span class="scout-result-strip__streak"[^>]*>(.*?)<\/span>/.exec(html);
    expect(streak?.[1]?.match(/<i /g)).toHaveLength(3);
    expect(html).toContain('data-result="loss"');
  });

  test("pads missing games at the old end and keeps only the newest slots", () => {
    const short = renderToStaticMarkup(
      <ResultStrip results={[win, loss, win]} />,
    );
    expect(short.match(/<i /g)).toHaveLength(20);
    expect(short.match(/data-result=/g)).toHaveLength(3);
    const long = renderToStaticMarkup(
      <ResultStrip results={[...twenty, loss, loss]} />,
    );
    expect(long.match(/<i /g)).toHaveLength(20);
    expect(long).toContain("Current streak: 2 losses.");
  });

  test("highlights a loss streak and skips a streak of one", () => {
    const losing = renderToStaticMarkup(
      <ResultStrip results={[win, loss, loss]} slots={3} />,
    );
    expect(losing).toContain(
      'class="scout-result-strip__streak" data-result="loss"',
    );
    const single = renderToStaticMarkup(
      <ResultStrip results={[loss, win]} slots={2} />,
    );
    expect(single).not.toContain("scout-result-strip__streak");
  });

  test("renders with no games", () => {
    const html = renderToStaticMarkup(<ResultStrip results={[]} />);
    expect(html).toContain('aria-label="No games yet."');
    expect(html.match(/<i /g)).toHaveLength(20);
  });
});

describe("WinRateBar", () => {
  test("formats at most one decimal", () => {
    expect(formatPercent(65)).toBe("65%");
    expect(formatPercent(51.8)).toBe("51.8%");
    expect(formatPercent(43.14)).toBe("43.1%");
    expect(formatPercent(50.04)).toBe("50%");
  });

  test("places values on a track the way the public page does", () => {
    expect(trackPosition(51.8, [48, 56])).toBeCloseTo(47.5, 5);
    expect(trackPosition(43.1, [30, 70])).toBeCloseTo(32.75, 5);
    expect(trackPosition(10, [40, 60])).toBe(0);
    expect(trackPosition(90, [40, 60])).toBe(100);
  });

  test("renders a filled bar with its value and an accessible summary", () => {
    const html = renderToStaticMarkup(<WinRateBar value={65} even you />);
    expect(html).toContain('style="width:65%"');
    expect(html).toContain('aria-label="Win rate 65%."');
    expect(html).toContain('data-you="true"');
    expect(html).toContain("scout-win-rate__even");
  });

  test("renders a range with a likely band and an even mark", () => {
    const html = renderToStaticMarkup(
      <WinRateBar
        variant="range"
        value={51.8}
        even
        range={{ low: 50.9, high: 52.7 }}
        domain={[48, 56]}
      />,
    );
    expect(html).toContain(
      'aria-label="51.8%, likely between 50.9% and 52.7%. 50% is an even game."',
    );
    expect(html).toContain("left:47.5%");
    expect(html).toContain("left:36.25%");
    expect(html).toContain("width:22.5%");
    expect(html).toContain("50%, even");
  });

  test("fails loudly on a value outside 0 to 100 or a backwards range", () => {
    expect(() => renderToStaticMarkup(<WinRateBar value={101} />)).toThrow(
      RangeError,
    );
    expect(() =>
      renderToStaticMarkup(<WinRateBar value={Number.NaN} />),
    ).toThrow(RangeError);
    expect(() =>
      renderToStaticMarkup(
        <WinRateBar variant="range" value={50} range={{ low: 55, high: 45 }} />,
      ),
    ).toThrow(RangeError);
  });
});

describe("initialOf", () => {
  test("takes the first letter or digit and upper-cases it", () => {
    expect(initialOf("Northstar")).toBe("N");
    expect(initialOf("  riverQuartz")).toBe("R");
    expect(initialOf("@mapleCarry")).toBe("M");
    expect(initialOf("#1 Fan")).toBe("1");
    expect(initialOf("유나")).toBe("유");
  });

  test("falls back to the first character, then to a question mark", () => {
    expect(initialOf("!!!")).toBe("!");
    expect(initialOf("   ")).toBe("?");
  });
});

describe("PersonInitial", () => {
  test("hides the disc from assistive technology and names the live state", () => {
    const html = renderToStaticMarkup(
      <PersonInitial name="Northstar" you live champion="Ahri" />,
    );
    expect(html).toContain('aria-hidden="true">N<');
    expect(html).toContain('data-you="true"');
    expect(html).toContain("In a game now");
    expect(html).toContain("scout-person__badge");
  });

  test("is plain without the optional parts", () => {
    const html = renderToStaticMarkup(<PersonInitial name="river" size="s" />);
    expect(html).not.toContain("scout-person__live");
    expect(html).not.toContain("scout-person__badge");
    expect(html).not.toContain("data-you");
  });
});

describe("ChampionFace", () => {
  test("sizes the face and names the result", () => {
    const html = renderToStaticMarkup(
      <ChampionFace champion="Ahri" size={76} result="win" />,
    );
    expect(html).toContain('data-size="76"');
    expect(html).toContain('alt="Ahri"');
    expect(html).toContain('data-result="win"');
    expect(html).toContain("Won");
    expect(html).toContain("<svg");
  });

  test("marks a loss without a check and allows a decorative face", () => {
    const html = renderToStaticMarkup(
      <ChampionFace champion={103} result="loss" alt="" />,
    );
    expect(html).toContain('data-result="loss"');
    expect(html).toContain("Lost");
    expect(html).not.toContain("<svg");
    expect(html).toContain('alt=""');
  });
});

describe("hero art", () => {
  test("mirrors art that faces away from the words", () => {
    // Art at the end of a hero should look left, toward the words.
    expect(isArtMirrored({ champion: "Ahri", face: "left" }, "end")).toBe(
      false,
    );
    expect(isArtMirrored({ champion: "Ahri", face: "right" }, "end")).toBe(
      true,
    );
    // Art at the start should look right.
    expect(isArtMirrored({ champion: "Ahri", face: "right" }, "start")).toBe(
      false,
    );
    expect(isArtMirrored({ champion: "Ahri", face: "left" }, "start")).toBe(
      true,
    );
  });

  test("leaves art alone without a facing, and lets mirrored override it", () => {
    expect(isArtMirrored({ champion: "Ahri" }, "end")).toBe(false);
    expect(isArtMirrored({ champion: "Ahri" }, "start")).toBe(false);
    expect(
      isArtMirrored({ champion: "Ahri", face: "left", mirrored: true }, "end"),
    ).toBe(true);
    expect(
      isArtMirrored(
        { champion: "Ahri", face: "right", mirrored: false },
        "end",
      ),
    ).toBe(false);
  });
});

describe("HeroPanel", () => {
  test("puts art on the side opposite the words", () => {
    const start = renderToStaticMarkup(
      <HeroPanel art={{ champion: "Ahri" }} aria-label="Northstar">
        <h1>Northstar</h1>
      </HeroPanel>,
    );
    expect(start).toContain('data-align="start"');
    expect(start).toContain('data-side="end"');
    expect(start).toContain('aria-label="Northstar"');
    const end = renderToStaticMarkup(
      <HeroPanel art={{ champion: "Ahri" }} align="end">
        <h1>Northstar</h1>
      </HeroPanel>,
    );
    expect(end).toContain('data-side="start"');
  });

  test("applies the facing to the art", () => {
    const html = renderToStaticMarkup(
      <HeroPanel art={{ champion: "Ahri", face: "right" }}>
        <h1>Northstar</h1>
      </HeroPanel>,
    );
    expect(html).toContain('data-mirrored="true"');
  });

  test("works with no art and keeps decorative art out of the accessibility tree", () => {
    const plain = renderToStaticMarkup(
      <HeroPanel action={<a href="#find">Find another player</a>}>
        <h1>Northstar</h1>
      </HeroPanel>,
    );
    expect(plain).toContain('data-art="none"');
    expect(plain).not.toContain("<img");
    expect(plain).toContain("Find another player");
    const withArt = renderToStaticMarkup(
      <HeroPanel art={{ champion: "Ahri" }}>
        <h1>Northstar</h1>
      </HeroPanel>,
    );
    expect(withArt).toContain('alt=""');
  });
});

describe("DuelHero", () => {
  test("shows each champion on its own side around the verdict", () => {
    const html = renderToStaticMarkup(
      <DuelHero
        start={{ champion: "Ahri", face: "left" }}
        end={{ champion: "Syndra", face: "left" }}
        aria-labelledby="duel"
      >
        <h1 id="duel">Ahri against Syndra</h1>
      </DuelHero>,
    );
    expect(html).toContain('data-side="start" data-mirrored="true"');
    expect(html).toContain('data-side="end" data-mirrored="false"');
    expect(html).toContain("Ahri against Syndra");
    expect(html.match(/<img /g)).toHaveLength(2);
  });
});

describe("RankLockup", () => {
  test("shows the rank, LP and the secondary line", () => {
    const html = renderToStaticMarkup(
      <RankLockup
        rank="Emerald"
        division="II"
        leaguePoints={64}
        secondary="Platinum I, 12 LP in Flex"
      />,
    );
    expect(html).toContain("Emerald II");
    expect(html).toContain("64 LP");
    expect(html).toContain("Platinum I, 12 LP in Flex");
    expect(html).toContain("scout-rank-lockup");
    expect(html).toContain('width="88"');
  });

  test("leaves out LP and the secondary line when they are not given", () => {
    const html = renderToStaticMarkup(<RankLockup rank="Challenger" />);
    expect(html).toContain("Challenger");
    expect(html).not.toContain("LP");
    expect(html).not.toContain("<small");
  });
});

describe("NameText", () => {
  test("keeps the whole name as text and in the title", () => {
    const name = "A friend with a very long summoner name";
    const html = renderToStaticMarkup(<NameText>{name}</NameText>);
    expect(html).toContain(`title="${name}"`);
    expect(html).toContain(`>${name}</span>`);
    expect(html).toContain("scout-name");
  });

  test("escapes the name in the title", () => {
    const html = renderToStaticMarkup(
      <NameText>{'Nunu & "Willump"'}</NameText>,
    );
    expect(html).toContain('title="Nunu &amp; &quot;Willump&quot;"');
  });
});
