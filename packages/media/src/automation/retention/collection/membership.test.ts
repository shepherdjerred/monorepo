import { expect, test } from "vitest";
import { nextCollectionChange } from "./membership.ts";

const foreign = { ratingKey: "2", guid: "plex://movie/foreign" };
const managed = { ratingKey: "3", guid: "plex://movie/managed" };
const newMovie = { ratingKey: "4", guid: "plex://movie/new" };
const actual = new Set(["2", "3"]);

test("removes Media's ended membership and preserves the existing writer's member", () => {
  expect(nextCollectionChange([], [managed], actual)).toEqual({
    item: managed,
    present: false,
  });
  expect(nextCollectionChange([], [], new Set(["2"]))).toBeNull();
});

test("a desired item already added by someone else stays unmanaged", () => {
  expect(
    nextCollectionChange([foreign, managed], [managed], actual),
  ).toBeNull();
  expect(nextCollectionChange([newMovie], [], actual)).toEqual({
    item: newMovie,
    present: true,
  });
});
