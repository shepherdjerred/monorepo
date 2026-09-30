import { describe, expect, test } from "vitest";
import type { MediaCandidate } from "@shepherdjerred/streambot/discovery/candidate.ts";
import {
  canonicalWorkKey,
  fuzzyMatchCandidate,
  pickOfficialSameWork,
} from "@shepherdjerred/streambot/discovery/same-work.ts";

function candidate(
  title: string,
  extras: Partial<MediaCandidate> = {},
): MediaCandidate {
  return {
    token: title,
    provider: "youtube",
    title,
    source: { kind: "url", url: `https://youtu.be/${title}` },
    score: 50,
    reason: "test",
    ...extras,
  };
}

describe("same-work matching", () => {
  test("collapses official, audio, and topic titles to one key", () => {
    expect(canonicalWorkKey("Travis Scott - SICKO MODE (Official Video)")).toBe(
      "travis scott sicko mode",
    );
    expect(canonicalWorkKey("SICKO MODE")).toBe("sicko mode");
  });

  test("picks the official video among same-work hits", () => {
    const official = candidate("Travis Scott - SICKO MODE (Official Video)", {
      channel: "TravisScottVEVO",
      score: 92,
    });
    expect(
      pickOfficialSameWork([
        candidate("SICKO MODE", {
          channel: "Various Artists - Topic",
          score: 96,
        }),
        candidate("Travis Scott - SICKO MODE", { score: 90 }),
        official,
      ]),
    ).toEqual(official);
  });

  test("keeps a local file ahead of a YouTube official upload of the same work", () => {
    const local = candidate("SICKO MODE", {
      provider: "local",
      score: 110,
    });
    expect(
      pickOfficialSameWork([
        local,
        candidate("Travis Scott - SICKO MODE (Official Video)", {
          channel: "TravisScottVEVO",
          score: 92,
        }),
      ]),
    ).toEqual(local);
  });

  test("does not treat Love and Love Story as the same work", () => {
    expect(
      pickOfficialSameWork([
        candidate("Love (Official Video)"),
        candidate("Love Story (Official Video)"),
      ]),
    ).toBeUndefined();
  });

  test("does not treat a franchise prefix as the same work as its sequels", () => {
    expect(
      pickOfficialSameWork([
        candidate("Harry Potter (Official Trailer)"),
        candidate("Harry Potter and the Chamber of Secrets"),
        candidate("Harry Potter and the Goblet of Fire"),
      ]),
    ).toBeUndefined();
  });

  test("does not treat a franchise prefix as the same work as a shared suffix", () => {
    expect(
      pickOfficialSameWork([
        candidate("Mission: Impossible - Fallout"),
        candidate("Fallout (Official Trailer)", {
          channel: "Paramount Pictures",
        }),
      ]),
    ).toBeUndefined();
  });

  test("does not treat a title suffix as an artist-stripped same work", () => {
    expect(
      pickOfficialSameWork([
        candidate("More Time"),
        candidate("Daft Punk - One More Time (Official Video)", {
          channel: "DaftPunkVEVO",
        }),
      ]),
    ).toBeUndefined();
  });

  test("does not strip title words that happen to match qualifier labels", () => {
    expect(canonicalWorkKey("Video Games")).toBe("video games");
    expect(canonicalWorkKey("Games (Official Video)")).toBe("games");
    expect(
      pickOfficialSameWork([
        candidate("Video Games"),
        candidate("Games (Official Video)"),
      ]),
    ).toBeUndefined();
  });

  test("does not strip Topic from a title that is not an auto-generated suffix", () => {
    expect(canonicalWorkKey("Le Tigre - Hot Topic")).toBe("le tigre hot topic");
    expect(
      pickOfficialSameWork([
        candidate("Le Tigre - Hot Topic", { channel: "Le Tigre" }),
        candidate("Hot (Official Video)"),
      ]),
    ).toBeUndefined();
  });

  test("fuzzy-matches Silco and Suka onto SICKO MODE", () => {
    const official = candidate("Travis Scott - SICKO MODE (Official Video)");
    const pending = [official, candidate("Travis Scott - SICKO MODE")];
    expect(fuzzyMatchCandidate(pending, "silco")?.title).toBe(official.title);
    expect(fuzzyMatchCandidate(pending, "Suka mode")?.title).toBe(
      official.title,
    );
  });

  test("does not reuse a pending One More Time for One More Night", () => {
    const pending = [
      candidate("Maroon 5 - One More Night (Official Video)"),
      candidate("Daft Punk - One More Time (Official Video)"),
    ];
    expect(fuzzyMatchCandidate(pending, "play One More Night")?.title).toBe(
      "Maroon 5 - One More Night (Official Video)",
    );
    expect(
      fuzzyMatchCandidate(
        [candidate("Daft Punk - One More Time (Official Video)")],
        "play One More Night",
      ),
    ).toBeNull();
    expect(
      fuzzyMatchCandidate(
        [candidate("Coldplay - Yellow (Official Video)")],
        "play Hello",
      ),
    ).toBeNull();
  });
});
