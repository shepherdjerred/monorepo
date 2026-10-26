import { expect, test } from "vitest";
import { verifyPlexAssociations } from "#automation/publication/association.ts";
import { associationFixture } from "./test-fixture.ts";

test("shared TV file binds every canonical episode through actual season and show metadata in both passes", async () => {
  const f = associationFixture("episode", 2);
  const result = await verifyPlexAssociations(
    { plex: f.createClient() },
    f.input,
    f.execution,
  );
  if ("status" in result) {
    throw new Error(`Expected serving proof: ${result.reason}`);
  }
  expect(result.associations).toHaveLength(2);
  expect(result.associations.map((row) => row.scope)).toEqual(
    f.input.expected.newGroups[0]?.coverage,
  );
  expect(
    result.associations.map((row) => row.item.media[0].parts[0].id),
  ).toEqual(["500", "500"]);
  for (const row of result.associations) {
    expect(row).toMatchObject({
      kind: "episode",
      hierarchy: {
        season: { ratingKey: "900", type: "season", parentRatingKey: "901" },
        show: { ratingKey: "901", type: "show", guids: ["tmdb://123"] },
      },
    });
    if (row.kind === "episode") {
      expect(row.hierarchy.season).not.toHaveProperty("sectionId");
      expect(row.hierarchy.show).not.toHaveProperty("sectionId");
    }
  }
  for (const key of ["10", "11", "900", "901"]) {
    expect(
      f.calls.filter((url) => url.pathname === `/library/metadata/${key}`),
    ).toHaveLength(2);
  }
});

test.each([
  "missing-parent",
  "missing-show",
  "wrong-season-link",
  "wrong-season-index",
  "wrong-show-kind",
  "wrong-show-guid",
  "conflicting-show-guid",
  "wrong-episode-number",
])("rejects %s without own-key or episode-ID fallback", async (failure) => {
  const f = associationFixture("episode");
  const item = f.items[0],
    season = f.metadata.get("900"),
    show = f.metadata.get("901");
  if (item === undefined || season === undefined || show === undefined) {
    throw new Error("Fixture hierarchy missing");
  }
  switch (failure) {
    case "missing-parent":
      delete item.parentRatingKey;
      break;
    case "missing-show":
      delete item.grandparentRatingKey;
      break;
    case "wrong-season-link":
      season.parentRatingKey = "902";
      break;
    case "wrong-season-index":
      season.index = 2;
      break;
    case "wrong-show-kind":
      show.type = "movie";
      break;
    case "wrong-show-guid":
      show.Guid = [{ id: "tmdb://1000" }];
      break;
    case "conflicting-show-guid":
      show.Guid = [{ id: "tmdb://123" }, { id: "tmdb://999" }];
      break;
    case "wrong-episode-number":
      item.index = 2;
      break;
  }
  await expect(
    verifyPlexAssociations({ plex: f.createClient() }, f.input, f.execution),
  ).resolves.toMatchObject({ status: "protected" });
  if (failure === "missing-parent" || failure === "missing-show") {
    expect(
      f.calls.filter((url) => url.pathname === "/library/metadata/10"),
    ).toHaveLength(1);
  }
});

test("a show identity replacement only in second-pass metadata invalidates the proof", async () => {
  const f = associationFixture("episode");
  let reads = 0;
  const plex = f.createClient((url) => {
    if (url.pathname === "/library/metadata/901" && ++reads === 2) {
      return Response.json({
        MediaContainer: {
          size: 1,
          Metadata: [
            {
              ratingKey: "901",
              type: "show",
              title: "Changed",
              Guid: [{ id: "tmdb://999" }],
            },
          ],
        },
      });
    }
    return;
  });
  await expect(
    verifyPlexAssociations({ plex }, f.input, f.execution),
  ).resolves.toEqual({ status: "protected", reason: "metadata_changed" });
  expect(reads).toBe(2);
});

test("canonical episode zero is matched literally, not renumbered", async () => {
  const f = associationFixture("episode");
  const target = f.input.canonicalTargets[0],
    item = f.items[0];
  if (item === undefined || target?.kind !== "episode") {
    throw new Error("Fixture episode missing");
  }
  target.coordinate.episodeNumber = 0;
  item.index = 0;
  await expect(
    verifyPlexAssociations({ plex: f.createClient() }, f.input, f.execution),
  ).resolves.toMatchObject({ purpose: "current_serving" });
});

test("a shared file missing one canonical leaf cannot bind the remaining episode", async () => {
  const f = associationFixture("episode", 2);
  f.items.pop();
  await expect(
    verifyPlexAssociations({ plex: f.createClient() }, f.input, f.execution),
  ).resolves.toEqual({ status: "protected", reason: "ambiguous_item" });
});

test("a different canonical root is rejected before reading the apparently matching TV hierarchy", async () => {
  const f = associationFixture("episode", 2);
  const target = f.input.canonicalTargets[0];
  if (target === undefined) {
    throw new Error("Fixture target missing");
  }
  target.canonicalRootId = crypto.randomUUID();
  await expect(
    verifyPlexAssociations({ plex: f.createClient() }, f.input, f.execution),
  ).resolves.toEqual({ status: "protected", reason: "scope_changed" });
  expect(f.calls).toHaveLength(0);
});
