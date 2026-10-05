import { describe, expect, it } from "vitest";
import { HistorySchema, historicalDate, restoreMessage } from "#src/history.ts";
import corpus from "#config/history.json";

describe("reviewed history corpus", () => {
  it("contains substantial public discussions with unique identities", () => {
    const history = HistorySchema.parse(corpus);
    expect(history.threads).toHaveLength(120);
    expect(
      history.threads.reduce((total, thread) => total + thread.posts.length, 0),
    ).toBe(1148);
    expect(
      history.threads.filter((thread) => thread.reconstructed),
    ).toHaveLength(9);
    expect(
      history.omitted.some((thread) => thread.reason.includes("Private")),
    ).toBe(true);
    expect(
      history.threads.every((thread) =>
        thread.posts.every((post) => post.date < Date.UTC(2017, 0, 1) / 1000),
      ),
    ).toBe(true);
  });
  it("converts Mountain board dates across daylight saving without changing exact ISO timestamps", () => {
    expect(historicalDate(null, "Apr 6, 2014 at 10:42 PM")).toBe(
      Date.parse("2014-04-07T04:42:00Z") / 1000,
    );
    expect(historicalDate(null, "Dec 15, 2014 at 12:50 PM")).toBe(
      Date.parse("2014-12-15T19:50:00Z") / 1000,
    );
    expect(historicalDate("2014-04-07T04:42:23Z", "ignored")).toBe(
      Date.parse("2014-04-07T04:42:23Z") / 1000,
    );
    expect(() => historicalDate(null, "unknown")).toThrow();
  });
  it("restores local imagery and attributed quotes without hotlinking missing images", () => {
    expect(
      restoreMessage(
        "[quote=Riot]Hello[/quote]\n[img http://i.imgur.com/abc.png]\n[img https://missing.invalid/a.png]",
        new Map([["https://i.imgur.com/abc.png", "image.png"]]),
      ),
    ).toBe(
      '[QUOTE="Riot"]Hello[/quote]\n[IMG]/data/storm-history/image.png[/IMG]',
    );
  });
});
