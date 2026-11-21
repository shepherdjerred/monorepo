import { expect, test } from "vitest";
import { z } from "zod";
import {
  libraryCursor,
  LibraryPageSchema,
  LibraryQuerySchema,
} from "#shared/household/library.ts";

const id = "00000000-0000-4000-8000-000000000001";
const titleCursor = JSON.stringify({ title: "Dune", id });
const addedCursor = JSON.stringify({
  addedAt: "2026-11-01T12:00:00.000Z",
  id,
});

test("a query with no parameters lists every title by name", () => {
  expect(LibraryQuerySchema.parse({})).toEqual({
    query: "",
    kind: "all",
    sort: "title",
    policy: "all",
    mine: "all",
    leaving: "all",
    availability: "all",
    cursor: null,
    limit: 25,
  });
});

test("each sort and filter accepts its own values and nothing else", () => {
  const accepted = {
    sort: ["title", "added"],
    policy: ["all", "keep", "temporary", "unclassified"],
    mine: ["all", "following"],
    leaving: ["all", "soon"],
    availability: ["all", "available", "unavailable"],
  };
  for (const [name, values] of Object.entries(accepted)) {
    for (const value of values)
      expect(
        LibraryQuerySchema.safeParse({ [name]: value }).success,
        `${name}=${value}`,
      ).toBe(true);
    for (const value of ["", "none", "ALL", "1"])
      expect(
        LibraryQuerySchema.safeParse({ [name]: value }).success,
        `${name}=${value}`,
      ).toBe(false);
  }
});

test("a cursor pages only the sort that issued it", () => {
  // The cursor an earlier client holds keeps paging the default sort.
  const byTitle = LibraryQuerySchema.parse({ cursor: titleCursor });
  expect(libraryCursor(byTitle)).toEqual({
    sort: "title",
    after: { title: "Dune", id },
  });
  const byAdded = LibraryQuerySchema.parse({
    sort: "added",
    cursor: addedCursor,
  });
  expect(libraryCursor(byAdded)).toEqual({
    sort: "added",
    after: { addedAt: "2026-11-01T12:00:00.000Z", id },
  });
  expect(libraryCursor(LibraryQuerySchema.parse({ sort: "added" }))).toEqual({
    sort: "added",
    after: null,
  });
  for (const mismatch of [
    { sort: "added", cursor: titleCursor },
    { sort: "title", cursor: addedCursor },
    { cursor: addedCursor },
  ]) {
    const refused = LibraryQuerySchema.safeParse(mismatch);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues).toMatchObject([{ path: ["cursor"] }]);
  }
});

test("a cursor that is not one the library issues is refused", () => {
  for (const cursor of [
    "not json",
    "null",
    "[]",
    JSON.stringify({ title: "Dune" }),
    JSON.stringify({ title: "Dune", id: "" }),
  ])
    expect(LibraryQuerySchema.safeParse({ cursor }).success, cursor).toBe(
      false,
    );
  for (const cursor of [
    JSON.stringify({ addedAt: "yesterday", id }),
    JSON.stringify({ addedAt: "2026-11-01", id }),
    JSON.stringify({ addedAt: 1_793_534_400_000, id }),
    JSON.stringify({ id }),
  ])
    expect(
      LibraryQuerySchema.safeParse({ sort: "added", cursor }).success,
      cursor,
    ).toBe(false);
  // A cursor that was never validated is a programming error, not a 400.
  expect(() => libraryCursor({ sort: "added", cursor: titleCursor })).toThrow(
    "cursor",
  );
});

const item = {
  id,
  title: "Severance",
  kind: "series",
  year: 2022,
  artwork: { posterPath: "/poster.jpg", backdropPath: null },
  policy: "temporary",
  myInterest: "following",
  availability: null,
  episodes: { available: 9, total: 19 },
  addedAt: "2026-11-17T08:30:00.000Z",
  leavingSoon: {
    state: "grace_period",
    graceUntil: "2026-11-27T00:00:00.000Z",
  },
  protection: "temporary_interest",
  libraryKeeping: null,
};

test("an item reports its episodes, when it was added and whether it is leaving, each nullable", () => {
  expect(LibraryPageSchema.parse({ items: [item], nextCursor: null })).toEqual({
    items: [item],
    nextCursor: null,
  });
  const bare = { ...item, episodes: null, addedAt: null, leavingSoon: null };
  expect(
    LibraryPageSchema.parse({ items: [bare], nextCursor: null }).items,
  ).toEqual([bare]);
  const waiting = {
    ...item,
    leavingSoon: { state: "warning_pending", graceUntil: null },
  };
  expect(
    LibraryPageSchema.safeParse({ items: [waiting], nextCursor: null }).success,
  ).toBe(true);
  // A quarantined title has already left; it is not "leaving soon".
  for (const leavingSoon of [
    { state: "quarantined", graceUntil: null },
    { state: "grace_period" },
  ])
    expect(
      LibraryPageSchema.safeParse({
        items: [{ ...item, leavingSoon }],
        nextCursor: null,
      }).success,
    ).toBe(false);
});

test("a browser tab on the earlier client still reads a page that carries the new fields", () => {
  // The item contract before this change: the same plain object, without the
  // three keys. A plain object ignores keys it does not know.
  const element = LibraryPageSchema.shape.items.element;
  const EarlierPageSchema = z.object({
    items: z.array(
      element.omit({ episodes: true, addedAt: true, leavingSoon: true }),
    ),
    nextCursor: z.string().nullable(),
  });
  const { episodes, addedAt, leavingSoon, ...earlier } = item;
  expect([episodes, addedAt, leavingSoon]).not.toContain(undefined);
  expect(EarlierPageSchema.parse({ items: [item], nextCursor: null })).toEqual({
    items: [earlier],
    nextCursor: null,
  });
});
