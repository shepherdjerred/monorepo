import { describe, expect, it } from "vitest";
import { LanguageSchema, type MediaUser } from "#shared/contract.ts";
import { DefaultCommandV2Schema } from "#shared/editions/commands.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { VERSION_COPY } from "#client/presentation/version.ts";
import {
  LANGUAGE_LIMIT,
  chosenSeasons,
  initialValues,
  movieOptions,
  partialMessage,
  readVersion,
  requestItems,
  televisionCommand,
  validationMessage,
  type SheetSubject,
  type TelevisionSubject,
} from "./form.ts";
import { COMMON_LANGUAGES, MORE_LANGUAGES, languageName } from "./languages.ts";

const owner: MediaUser = {
  id: "10000000-0000-4000-8000-000000000001",
  plexAccountId: "1",
  displayName: "Robin",
  role: "owner",
  restricted: false,
  version: 1,
};
const member: MediaUser = { ...owner, role: "member", displayName: "Mei" };
const kids = "10000000-0000-4000-8000-000000000005";

const film: SheetSubject = {
  kind: "movie",
  title: "Arrival",
  target: { externalId: 329_865 },
};
const series: TelevisionSubject = {
  kind: "series",
  title: "Severance",
  target: { mediaId: "20000000-0000-4000-8000-000000000001" },
  seasons: [
    { seasonNumber: 0, title: "Specials", episodeCount: 3 },
    { seasonNumber: 1, title: "Season 1", episodeCount: 9 },
    { seasonNumber: 2, title: "Season 2", episodeCount: 10 },
  ],
};
const season: TelevisionSubject = {
  kind: "season",
  seasonNumber: 2,
  title: "Severance, Season 2",
  target: { mediaId: "30000000-0000-4000-8000-000000000002" },
};
const specialsSeason: TelevisionSubject = {
  kind: "season",
  seasonNumber: 0,
  title: "Severance, Specials",
  target: { mediaId: "30000000-0000-4000-8000-000000000000" },
};
const episode: TelevisionSubject = {
  kind: "episode",
  title: "Severance, Good News About Hell",
  target: { mediaId: "40000000-0000-4000-8000-000000000101" },
};
/** The series' seasons as the library holds them. */
const children = [
  {
    id: "30000000-0000-4000-8000-000000000000",
    kind: "season",
    seasonNumber: 0,
  },
  {
    id: "30000000-0000-4000-8000-000000000001",
    kind: "season",
    seasonNumber: 1,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    kind: "season",
    seasonNumber: 2,
  },
] as const;
const seriesId = "20000000-0000-4000-8000-000000000001";
/** The library item the sheet was opened for. */
function idOf(subject: TelevisionSubject): string {
  return "mediaId" in subject.target ? subject.target.mediaId : seriesId;
}

describe("the sheet as it opens", () => {
  it("a member's request is just for now, in English, for themselves", () => {
    expect(initialValues(film, member)).toEqual({
      requesterUserId: member.id,
      version: "default",
      keeping: "temporary",
      languages: ["en"],
      scope: "series",
      seasons: [],
      future: false,
      specials: false,
    });
    expect(validationMessage(film, initialValues(film, member))).toBeNull();
  });

  it("the owner has to say how long to keep the title", () => {
    const values = initialValues(film, owner);
    expect(values.keeping).toBe("");
    expect(validationMessage(film, values)).toBe("Choose how long to keep it.");
    expect(validationMessage(film, { ...values, keeping: "keep" })).toBeNull();
  });

  it("a whole series follows new episodes unless told otherwise", () => {
    expect(initialValues(series, member).future).toBe(true);
    expect(initialValues(season, member).future).toBe(false);
  });
});

describe("a series, season or episode request", () => {
  it("is the command the API accepts, with the sheet's answers", () => {
    const command = televisionCommand(
      {
        ...initialValues(series, owner),
        keeping: "keep",
        languages: ["en", "zh-Hans"],
        specials: true,
      },
      owner,
      "series",
    );
    expect(command).toEqual({
      action: "request",
      keepingPolicy: "keep",
      subtitleLanguages: ["en", "zh-Hans"],
      includeFutureEpisodes: true,
      includeSpecials: true,
    });
    expect(
      DefaultCommandV2Schema.safeParse({
        schemaVersion: 2,
        scope: {
          mediaId: "20000000-0000-4000-8000-000000000001",
          edition: "default",
        },
        expected: { mediaVersion: 3, targetVersion: null },
        command,
      }).success,
    ).toBe(true);
  });

  it("names the person only when the owner asks for someone else", () => {
    const forKids = televisionCommand(
      {
        ...initialValues(series, owner),
        keeping: "temporary",
        requesterUserId: kids,
      },
      owner,
      "series",
    );
    expect(forKids.requesterUserId).toBe(kids);
    expect(
      televisionCommand(initialValues(series, member), member, "series"),
    ).not.toHaveProperty("requesterUserId");
  });

  it("asks for a numbered season or an episode as it is", () => {
    const command = televisionCommand(
      { ...initialValues(series, member), future: true, specials: true },
      member,
      "part",
    );
    expect(command.includeFutureEpisodes).toBe(false);
    expect(command.includeSpecials).toBe(false);
  });

  it("asks for the Specials season's episodes when that season is what is asked for", () => {
    // The server leaves season-zero episodes out of any request that does
    // not include specials, a request for the Specials season among them.
    const command = televisionCommand(
      initialValues(series, member),
      member,
      "specials",
    );
    expect(command.includeSpecials).toBe(true);
    // Following new episodes is asked of a whole series only.
    expect(command.includeFutureEpisodes).toBe(false);
    expect(
      DefaultCommandV2Schema.safeParse({
        schemaVersion: 2,
        scope: { mediaId: children[0].id, edition: "default" },
        expected: { mediaVersion: 3, targetVersion: null },
        command,
      }).success,
    ).toBe(true);
  });

  it("asks for no subtitles when none are chosen, and for each once", () => {
    const values = initialValues(season, member);
    expect(
      televisionCommand({ ...values, languages: [] }, member, "part")
        .subtitleLanguages,
    ).toEqual([]);
    expect(
      televisionCommand(
        { ...values, languages: ["en", "fr", "en"] },
        member,
        "part",
      ).subtitleLanguages,
    ).toEqual(["en", "fr"]);
  });

  it("refuses to build a command the sheet would not send", () => {
    expect(() =>
      televisionCommand(initialValues(series, owner), owner, "series"),
    ).toThrow("Choose how long to keep it.");
  });
});

describe("choosing seasons", () => {
  it("the whole series names no season", () => {
    const values = { ...initialValues(series, member), seasons: [1, 2] };
    expect(chosenSeasons(series, values)).toEqual([]);
    expect(validationMessage(series, values)).toBeNull();
  });

  it("some seasons are sent in order, each once, and only ones that exist", () => {
    const values = {
      ...initialValues(series, member),
      scope: "seasons" as const,
      seasons: [2, 1, 2, 7],
    };
    expect(chosenSeasons(series, values)).toEqual([1, 2]);
    expect(validationMessage(series, values)).toBeNull();
  });

  it("needs at least one season once seasons are being chosen", () => {
    const values = {
      ...initialValues(series, member),
      scope: "seasons" as const,
    };
    expect(validationMessage(series, values)).toBe(
      "Choose at least one season.",
    );
  });

  it("means nothing for a film or a single season", () => {
    const values = {
      ...initialValues(season, member),
      scope: "seasons" as const,
      seasons: [1],
    };
    expect(chosenSeasons(season, values)).toEqual([]);
    expect(validationMessage(season, values)).toBeNull();
    expect(chosenSeasons(film, values)).toEqual([]);
  });
});

/** Each command a request sends: what it names and whether it brings specials. */
function commands(subject: TelevisionSubject, seasons: readonly number[]) {
  return requestItems(subject, idOf(subject), seasons, children).map(
    (item) => ({
      mediaId: item.mediaId,
      seasonNumber: item.seasonNumber,
      includeSpecials: televisionCommand(
        { ...initialValues(subject, member), specials: false },
        member,
        item.scope,
      ).includeSpecials,
    }),
  );
}

describe("what one request sends, item by item", () => {
  it("the whole series is one command, with the sheet's answer on specials", () => {
    expect(requestItems(series, seriesId, [], children)).toEqual([
      { mediaId: seriesId, seasonNumber: null, scope: "series" },
    ]);
    expect(commands(series, [])[0]?.includeSpecials).toBe(false);
  });

  it("Specials ticked among the seasons is asked for with its episodes", () => {
    expect(commands(series, [0, 2])).toEqual([
      { mediaId: children[0].id, seasonNumber: 0, includeSpecials: true },
      { mediaId: children[2].id, seasonNumber: 2, includeSpecials: false },
    ]);
  });

  it("the Specials season's own page asks for its episodes too", () => {
    expect(commands(specialsSeason, [])).toEqual([
      { mediaId: children[0].id, seasonNumber: 0, includeSpecials: true },
    ]);
    expect(commands(season, [])[0]?.includeSpecials).toBe(false);
    expect(commands(episode, [])[0]?.includeSpecials).toBe(false);
  });

  it("refuses a season the library does not hold yet, in the reader's words", () => {
    expect(() => requestItems(series, seriesId, [1, 7], children)).toThrow(
      "Season 7 is still being added to the library. Try again in a moment.",
    );
  });
});

describe("a request for several seasons that stopped part-way", () => {
  it("says which seasons are requested and which are not, by their names", () => {
    expect(partialMessage(series, [1], [2])).toBe(
      "Season 1 is requested. Season 2 is not yet. Your answers stay as they were sent, so the rest is asked for the same way: choose Request to try again, or Cancel to leave it there.",
    );
    expect(partialMessage(series, [0, 1], [2])).toMatch(
      /^Specials and Season 1 are requested\. Season 2 is not yet\./u,
    );
    expect(partialMessage(series, [1], [0, 2])).toMatch(
      /^Season 1 is requested\. Specials and Season 2 are not yet\./u,
    );
  });
});

describe("a film request", () => {
  it("carries how long to keep it and the subtitle languages", () => {
    expect(
      movieOptions({
        ...initialValues(film, owner),
        keeping: "temporary",
        languages: ["zh-Hans"],
      }),
    ).toEqual({ keepingPolicy: "temporary", subtitleLanguages: ["zh-Hans"] });
  });

  it("offers every version the registry lists, each by a plain name", () => {
    for (const edition of MovieEditionKeySchema.options) {
      expect(readVersion(edition)).toBe(edition);
      expect(VERSION_COPY[edition]).not.toMatch(/unmarked|edition|_/iu);
    }
    expect(() => readVersion("imax")).toThrow();
  });
});

describe("the subtitle languages on offer", () => {
  const offered = [...COMMON_LANGUAGES, ...MORE_LANGUAGES];

  it("are tags the API accepts, each listed once", () => {
    for (const language of offered) {
      expect(LanguageSchema.safeParse(language.code).success).toBe(true);
    }
    expect(new Set(offered.map((language) => language.code)).size).toBe(
      offered.length,
    );
    expect(new Set(offered.map((language) => language.label)).size).toBe(
      offered.length,
    );
  });

  it("cannot exceed what one request may carry", () => {
    const values = {
      ...initialValues(film, member),
      languages: offered.map((language) => language.code),
    };
    expect(offered.length).toBeGreaterThan(LANGUAGE_LIMIT);
    expect(validationMessage(film, values)).toBe(
      "Choose at most 20 subtitle languages.",
    );
  });

  it("names a language by what a request or a file calls it", () => {
    expect(languageName("en")).toBe("English");
    expect(languageName("zh-Hans")).toBe("Chinese (Simplified)");
    // What the comma-separated field used to ask people to type.
    expect(languageName("zh-CN")).toBe("Chinese (Simplified)");
    // Outside the list: the browser's name for it.
    expect(languageName("cy")).toBe("Welsh");
  });
});
