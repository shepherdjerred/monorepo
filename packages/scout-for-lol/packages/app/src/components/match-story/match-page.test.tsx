import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, test, vi } from "vitest";
import {
  MATCH_FIXTURE_NOW,
  matchDetailFixture,
  matchStoryFixture,
  type MatchFixtureOptions,
} from "#src/components/match-story/match-page.fixture.ts";
import {
  MatchPage,
  type StoryState,
} from "#src/components/match-story/match-page.tsx";

function render(options: MatchFixtureOptions, story: StoryState): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <MatchPage
        detail={matchDetailFixture(options)}
        story={story}
        profilePath="/players/1?games=20"
        now={MATCH_FIXTURE_NOW}
      />
    </MemoryRouter>,
  );
}

function done(options: MatchFixtureOptions): StoryState {
  return { status: "done", story: matchStoryFixture(options) };
}

describe("a match with a timeline", () => {
  const html = render({}, done({}));

  test("leads with the result, score, friends and LP change", () => {
    expect(html).toContain("Northstar won as Ahri");
    expect(html).toContain(
      "9/2/11 in a 28-minute game, with RiverQuartz and TidalWren.",
    );
    expect(html).toContain(
      "Up 21 LP to Emerald II, 64 LP. Ranked Solo, 2 hours ago.",
    );
  });

  test("states the lane at 15 minutes as a figure", () => {
    expect(html).toContain("Ahead of Yasuo at 15 minutes, by 640 gold.");
    expect(html).toContain("14 more minions, 320 more experience");
  });

  test("draws the gold lead from the story and lists the moments", () => {
    expect(html).toContain("How it went");
    expect(html).toContain("scout-gold-chart");
    expect(html).toContain("Blue ahead");
    expect(html).toContain("First blood at 3:12 by Northstar");
    expect(html).toContain("Baron at 24:40 by Northstar");
  });

  test("shows both teams with damage and a fold for everyone's build", () => {
    expect(html).toContain("Your team");
    expect(html).toContain("Their team");
    expect(html).toContain("Mossback#NA1");
    expect(html).toContain("31.2K");
    expect(html).toContain("RiverQuartz did the most damage to champions.");
    expect(html).toContain("Show more stats");
    expect(html).toContain("Skill order");
  });

  test("shows the build in purchase order and the rune page", () => {
    expect(html).toContain("Malignance");
    expect(html).toContain("Electrocute");
    expect(html).toContain("Sorcery second");
    expect(html).toContain("Flash");
  });

  test("links tracked friends and writes no explanatory copy", () => {
    expect(html).toContain('href="/players/2"');
    expect(html).not.toContain("Only games with a timeline");
  });
});

describe("while the story loads", () => {
  test("paints the page from the detail with a placeholder below", () => {
    const html = render({}, { status: "loading" });
    expect(html).toContain("Northstar won as Ahri");
    expect(html).toContain("Both teams");
    expect(html).toContain("Loading the game");
    expect(html).not.toContain("scout-gold-chart");
  });

  test("offers a retry when the story fails and keeps the rest", () => {
    const html = render({}, { status: "error", retry: vi.fn() });
    expect(html).toContain("This part of the game is unavailable.");
    expect(html).toContain("Retry");
    expect(html).toContain("Both teams");
  });
});

describe("a match with no timeline", () => {
  const options = { timeline: false, lp: "none" } as const;
  const html = render(options, done(options));

  test("shows only what exists: no chart, no lane, no moments", () => {
    expect(html).toContain("Northstar won as Ahri");
    expect(html).not.toContain("scout-gold-chart");
    expect(html).not.toContain("How it went");
    expect(html).not.toContain("Moments");
    expect(html).not.toContain("at 15 minutes");
    expect(html).not.toContain("Skill order");
    expect(html).not.toContain("LP");
  });

  test("still shows both teams and the final items", () => {
    expect(html).toContain("Both teams");
    expect(html).toContain("Malignance");
  });

  test("draws no placeholder while the story loads", () => {
    const loading = render(options, { status: "loading" });
    expect(loading).not.toContain("Loading the game");
  });
});

describe("a remake", () => {
  const options = { remake: true, lp: "none" } as const;
  const html = render(options, done(options));

  test("says it was remade and states no result or LP", () => {
    expect(html).toContain("Northstar played Ahri");
    expect(html).toContain("Remade, no result.");
    expect(html).not.toContain(" won as ");
    expect(html).not.toContain(">Won<");
    expect(html).not.toContain(" LP");
  });

  test("has no lane result and no friends sentence about a win", () => {
    expect(html).not.toContain("at 15 minutes");
    expect(html).not.toContain("With friends");
  });
});

describe("a viewer on the other team", () => {
  test("reads the lane and the result from their side", () => {
    const options = { viewerOnRed: true } as const;
    const html = render(options, done(options));
    expect(html).toContain("Northstar lost as Ahri");
    expect(html).toContain("Ahead of Yasuo at 15 minutes, by 640 gold.");
    expect(html).toContain("Red ahead");
  });
});
