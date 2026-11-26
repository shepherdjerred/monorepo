import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  ClimbChart,
  climbChange,
  climbDomain,
  climbPath,
  climbSummary,
  type ClimbSeries,
} from "./climb-chart.tsx";
import {
  GoldLeadChart,
  goldLeadSummary,
  goldLeadText,
  goldScale,
  matchClock,
} from "./gold-lead-chart.tsx";
import { PageLoading, PageState } from "#src/domain/profile/page-states.tsx";

const northstar: ClimbSeries = {
  id: "n",
  name: "Northstar",
  you: true,
  points: [1230, 1250, 1232, 1293],
};
const halcyon: ClimbSeries = {
  id: "h",
  name: "Halcyon",
  points: [1180, 1170, 1221],
};

describe("climb chart helpers", () => {
  test("formats the change with a true minus", () => {
    expect(climbChange(1230, 1293, "LP")).toBe("+63 LP");
    expect(climbChange(1400, 1388, "LP")).toBe("−12 LP");
    expect(climbChange(1200, 1200, "LP")).toBe("no change");
  });

  test("summarises every series with its start, end and games", () => {
    expect(climbSummary([northstar, halcyon], "LP")).toBe(
      "Northstar: 1,230 LP to 1,293 LP over 3 games, +63 LP. Halcyon: 1,180 LP to 1,221 LP over 2 games, +41 LP.",
    );
    expect(climbSummary([], "LP")).toBe("No rank history yet.");
    expect(
      climbSummary([{ id: "e", name: "Northstar", points: [] }], "LP"),
    ).toBe("No rank history yet.");
  });

  test("pads the domain and survives a flat line", () => {
    const domain = climbDomain([northstar, halcyon]);
    expect(domain.min).toBeLessThan(1170);
    expect(domain.max).toBeGreaterThan(1293);
    const flat = climbDomain([{ id: "f", name: "F", points: [5, 5] }]);
    expect(flat.max - flat.min).toBeGreaterThan(0);
  });

  test("draws a path from the oldest point to the newest", () => {
    const path = climbPath([0, 10], { min: 0, max: 10 });
    expect(path).toBe("M0,100 L100,0");
  });
});

describe("ClimbChart", () => {
  test("one line has an area, two dots and a text alternative", () => {
    const html = renderToStaticMarkup(
      <ClimbChart
        series={[northstar]}
        startLabel="Start"
        nowLabel="Now"
        marks={[{ index: 2, label: "Reached Emerald" }]}
      />,
    );
    expect(html).toContain('data-count="one"');
    expect(html).toContain('role="img"');
    expect(html).toContain("Northstar: 1,230 LP to 1,293 LP");
    expect(html).toContain("scout-climb__area");
    expect(html.match(/scout-climb__dot"/g)).toHaveLength(2);
    expect(html).toContain("Reached Emerald");
    expect(html).not.toContain("scout-climb__legend");
    expect(html).toContain('data-series="brand"');
  });

  test("several lines get chart colours, a legend and no area", () => {
    const html = renderToStaticMarkup(
      <ClimbChart series={[northstar, halcyon]} />,
    );
    expect(html).toContain('data-count="many"');
    expect(html).toContain('data-series="2"');
    expect(html).toContain('data-you="true"');
    expect(html).toContain("scout-climb__legend");
    expect(html).toContain("+41 LP");
    expect(html).not.toContain("scout-climb__area");
  });

  test("a single game is one dot and no line; no history is just the text", () => {
    const one = renderToStaticMarkup(
      <ClimbChart series={[{ id: "o", name: "N", points: [1230] }]} />,
    );
    expect(one).not.toContain("scout-climb__line");
    expect(one.match(/scout-climb__dot"/g)).toHaveLength(1);
    const none = renderToStaticMarkup(
      <ClimbChart series={[{ id: "z", name: "N", points: [] }]} />,
    );
    expect(none).toContain("No rank history yet.");
    expect(none).not.toContain("scout-climb__dot");
  });

  test("takes a replacement label", () => {
    const html = renderToStaticMarkup(
      <ClimbChart series={[northstar]} label="Climb this split" />,
    );
    expect(html).toContain('aria-label="Climb this split"');
  });
});

describe("gold lead helpers", () => {
  test("formats the clock", () => {
    expect(matchClock(0)).toBe("0:00");
    expect(matchClock(125_000)).toBe("2:05");
    expect(matchClock(1_925_000)).toBe("32:05");
  });

  test("says who leads", () => {
    expect(goldLeadText(1200, "Blue", "Red")).toBe(
      "Blue team leads by 1,200 gold",
    );
    expect(goldLeadText(-3400, "Blue", "Red")).toBe(
      "Red team leads by 3,400 gold",
    );
    expect(goldLeadText(0, "Blue", "Red")).toBe("Gold is even");
    expect(goldLeadText(null, "Blue", "Red")).toBe(
      "Gold comparison unavailable",
    );
  });

  test("scales to at least 1,000 and to the biggest gap", () => {
    expect(goldScale([{ timeMs: 0, lead: 300 }])).toBe(1000);
    expect(
      goldScale([
        { timeMs: 0, lead: -4200 },
        { timeMs: 1, lead: null },
      ]),
    ).toBe(4200);
  });

  test("summarises the end of the game and the biggest gap", () => {
    expect(
      goldLeadSummary(
        [
          { timeMs: 0, lead: 0 },
          { timeMs: 600_000, lead: -2500 },
          { timeMs: 1_200_000, lead: 900 },
        ],
        "Blue",
        "Red",
      ),
    ).toBe(
      "Gold advantage over time. Blue team leads by 900 gold at 20:00. The largest gap was 2,500 gold at 10:00.",
    );
    expect(goldLeadSummary([{ timeMs: 0, lead: null }], "Blue", "Red")).toBe(
      "Gold comparison unavailable.",
    );
  });
});

describe("GoldLeadChart", () => {
  const points = [
    { timeMs: 0, lead: 0 },
    { timeMs: 300_000, lead: 1500 },
    { timeMs: 600_000, lead: -800 },
  ];

  test("draws both sides, the line and the cursor, with a table of values", () => {
    const html = renderToStaticMarkup(
      <GoldLeadChart points={points} cursorMs={300_000} />,
    );
    expect(html).toContain('data-side="positive"');
    expect(html).toContain('data-side="negative"');
    expect(html).toContain("scout-gold-chart__line");
    expect(html).toContain("scout-gold-chart__cursor");
    expect(html).toContain("<details");
    expect(html).toContain("5:00");
    expect(html).toContain("Red team leads by 800 gold");
    expect(html).toContain("1,500 gold");
  });

  test("draws no line without two known values", () => {
    const html = renderToStaticMarkup(
      <GoldLeadChart
        points={[
          { timeMs: 0, lead: null },
          { timeMs: 1000, lead: null },
        ]}
      />,
    );
    expect(html).not.toContain("scout-gold-chart__line");
    expect(html).toContain("Gold comparison unavailable.");
  });

  test("names the teams", () => {
    const html = renderToStaticMarkup(
      <GoldLeadChart
        points={points}
        positiveName="Your"
        negativeName="Their"
      />,
    );
    expect(html).toContain("Your ahead");
    expect(html).toContain("Their ahead");
  });
});

describe("page states", () => {
  test("an empty state has a heading, a sentence and actions, and no icon", () => {
    const html = renderToStaticMarkup(
      <PageState
        kind="empty"
        id="t"
        title="Lately"
        lead="No games yet"
        detail="Scout starts keeping track from the next game."
        actions={<a href="#add">Add a Riot account</a>}
      />,
    );
    expect(html).toContain('aria-labelledby="t"');
    expect(html).toContain("<h2");
    expect(html).toContain("No games yet");
    expect(html).toContain("Add a Riot account");
    expect(html).not.toContain("scout-page-state__icon");
  });

  test("not found and unavailable carry a decorative icon and take a level", () => {
    const html = renderToStaticMarkup(
      <PageState
        kind="not-found"
        id="n"
        level={1}
        title="Player not found"
        lead="No one called Northstar here"
      />,
    );
    expect(html).toContain("<h1");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("scout-page-state__icon");
    expect(html).not.toContain("scout-page-state__detail");
    const unavailable = renderToStaticMarkup(
      <PageState kind="unavailable" id="u" title="Games" lead="Unavailable" />,
    );
    expect(unavailable).toContain('data-kind="unavailable"');
  });

  test("loading is a busy status with a spoken label and hidden placeholders", () => {
    const html = renderToStaticMarkup(<PageLoading label="Loading players" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading players");
    const list = renderToStaticMarkup(<PageLoading shape="list" rows={3} />);
    expect(list.match(/scout-page-loading__row"/g)).toHaveLength(3);
  });
});
