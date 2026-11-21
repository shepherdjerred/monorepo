import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  CatalogSearchSchema,
  RemovalListSchema,
  RequestListSchema,
} from "#shared/api.ts";
import { ApiErrorSchema } from "#shared/contract.ts";
import { CalendarPageSchema } from "#shared/household/calendar.ts";
import { RequestInterestListSchema } from "#shared/household/interests.ts";
import { LibraryPageSchema } from "#shared/household/library.ts";
import { NowPlayingSchema } from "#shared/household/playback.ts";
import { MovieEditionRequestListV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { RecoveryListSchema } from "#shared/recovery.ts";
import { localToday } from "#client/calendar/dates.ts";
import {
  interestChecks,
  onTheWay,
  ownerDecisions,
  thisWeek,
  weekFrom,
} from "#client/home/model.ts";
import { leavingTitles } from "#client/library/removals.ts";
import { personaUser, type Persona } from "./personas.ts";
import { routeFixture } from "./router.ts";
import type { FixtureScenario } from "./scenario.ts";
import { NOW } from "./support.ts";

/*
 * Home is made of six reads. These run what each section shows over the
 * answers the fixture API gives, so a fixture that stops filling a section
 * (or a scenario that stops emptying or failing one) fails here, without a
 * browser.
 */

const PERSONAS = ["member", "owner"] as const;
const TODAY = localToday(new Date(NOW));
const WEEK = `from=${TODAY}&to=${weekFrom(TODAY).to}`;

/** One read, by its path below `/api` ("/v1/requests"). */
function answer(path: string, persona: Persona, scenario: FixtureScenario) {
  const outcome = routeFixture({
    method: "GET",
    url: new URL(`http://fixture.invalid/api${path}`),
    persona,
    scenario,
  });
  return { status: outcome.status, body: outcome.body };
}

function read<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  persona: Persona,
  scenario: FixtureScenario,
): z.output<Schema> {
  const { status, body } = answer(path, persona, scenario);
  if (status !== 200) throw new Error(`${path}: HTTP ${String(status)}`);
  return schema.parse(body);
}

/**
 * How much each part of Home has to show for one persona, each counted from
 * its own read when asked. What a restore left to decide is read for the
 * owner alone.
 */
function sections(
  persona: Persona,
  scenario: FixtureScenario,
): Record<string, () => number> {
  const user = personaUser(persona);
  const requests = () =>
    read("/v1/requests", RequestListSchema, persona, scenario);
  return {
    checks: () =>
      interestChecks(
        read(
          "/v1/request-interests?include=artwork",
          RequestInterestListSchema,
          persona,
          scenario,
        ).items,
        requests(),
        user.id,
      ).length,
    ...(persona === "owner"
      ? {
          decisions: () =>
            ownerDecisions(
              read("/v1/recovery", RecoveryListSchema, persona, scenario),
            ).length,
        }
      : {}),
    playing: () =>
      read("/v1/playback/now-playing", NowPlayingSchema, persona, scenario)
        .items.length,
    onTheWay: () => onTheWay(requests(), user.id).length,
    added: () =>
      read("/v1/library?sort=added", LibraryPageSchema, persona, scenario).items
        .length,
    week: () =>
      thisWeek(
        read(`/v1/calendar?${WEEK}`, CalendarPageSchema, persona, scenario)
          .events,
        TODAY,
      ).length,
    leaving: () =>
      leavingTitles(read("/v1/removals", RemovalListSchema, persona, scenario))
        .length,
  };
}

describe("Home's fixtures", () => {
  it.each(PERSONAS)("fill every section for the %s", (persona) => {
    for (const [section, shown] of Object.entries(
      sections(persona, "default"),
    )) {
      expect(shown(), section).toBeGreaterThan(0);
    }
  });

  it("give the owner more than one stream, and a member only their own", () => {
    expect(sections("owner", "default")["playing"]?.()).toBeGreaterThan(1);
    expect(sections("member", "default")["playing"]?.()).toBe(1);
  });

  it("fill the week ahead on every day of the month, with today first", () => {
    const { events } = read(
      `/v1/calendar?${WEEK}`,
      CalendarPageSchema,
      "member",
      "default",
    );
    const days = thisWeek(events, TODAY);
    // Today and the week's last day both have something, so the week is
    // whole whatever the date: the month's own schedule stops at the 28th.
    expect(days[0]?.date).toBe(TODAY);
    expect(days[0]?.events.length).toBeGreaterThan(0);
    expect(days.at(-1)?.date).toBe(weekFrom(TODAY).to);
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
  });

  it.each(PERSONAS)(
    "new-household: no section has anything for the %s",
    (persona) => {
      for (const [section, shown] of Object.entries(
        sections(persona, "new-household"),
      )) {
        expect(shown(), section).toBe(0);
      }
      // The Library's other reads agree with it.
      expect(
        read(
          "/v4/movie-requests",
          MovieEditionRequestListV4Schema,
          persona,
          "new-household",
        ).items,
      ).toEqual([]);
      expect(
        read(
          "/v1/library?query=&kind=all",
          LibraryPageSchema,
          persona,
          "new-household",
        ),
      ).toEqual({ items: [], nextCursor: null });
      // And no catalog title claims to be in a library that is empty.
      const trending = read(
        "/v1/catalog/discover?feed=trending",
        CatalogSearchSchema,
        persona,
        "new-household",
      );
      expect(trending.libraryAccess).toBe("current");
      expect(trending.results.every((title) => title.library === null)).toBe(
        true,
      );
    },
  );

  it("library-unavailable: the library read fails as a broken read does; the rest answer", () => {
    for (const path of [
      "/v1/library?sort=added",
      "/v1/library?query=&kind=all",
    ]) {
      const { status, body } = answer(path, "member", "library-unavailable");
      expect(status, path).toBe(500);
      expect(ApiErrorSchema.parse(body).error.code, path).toBe(
        "internal_error",
      );
    }
    for (const persona of PERSONAS) {
      for (const [section, shown] of Object.entries(
        sections(persona, "library-unavailable"),
      )) {
        if (section === "added") {
          expect(shown, persona).toThrow("HTTP 500");
        } else {
          expect(shown(), `${persona} ${section}`).toBeGreaterThan(0);
        }
      }
    }
  });
});
