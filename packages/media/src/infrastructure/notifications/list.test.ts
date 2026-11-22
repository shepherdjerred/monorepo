import { describe, expect, it } from "vitest";
import type { MediaReference } from "#shared/household/media-reference.ts";
import { notificationEventMedia } from "./list.ts";

const movie: MediaReference = {
  id: "movie",
  rootMediaId: "movie",
  rootTitle: "Dune",
  kind: "movie",
  title: "Dune",
  artwork: { posterPath: "/dune.jpg", backdropPath: null },
};
const titles = new Map([[movie.id, movie]]);
const owner = { role: "owner" } as const;
const member = { role: "member" } as const;

describe("the title a notification event names", () => {
  it("names the item an event is about to the person it was delivered to", () => {
    for (const kind of [
      "media_available",
      "media_upgraded",
      "subtitles_ready",
      "acquisition_failed",
      "files_quarantined",
      "files_purged",
      "retention_warning",
      "interest_check",
    ]) {
      expect(
        notificationEventMedia(member, { mediaId: movie.id, kind }, titles),
        kind,
      ).toEqual(movie);
    }
  });

  it("names nothing for an event about no item, or about one that no longer exists", () => {
    expect(
      notificationEventMedia(
        owner,
        { mediaId: null, kind: "owner_health" },
        titles,
      ),
    ).toBeNull();
    expect(
      notificationEventMedia(
        member,
        { mediaId: "deleted", kind: "files_purged" },
        titles,
      ),
    ).toBeNull();
  });

  it("names an intervention's title only while its reader is an owner", () => {
    const event = { mediaId: movie.id, kind: "system_intervention" };
    expect(notificationEventMedia(owner, event, titles)).toEqual(movie);
    expect(notificationEventMedia(member, event, titles)).toBeNull();
  });
});
