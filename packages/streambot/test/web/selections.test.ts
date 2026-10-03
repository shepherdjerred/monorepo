import { expect, test } from "vitest";
import { Selections } from "@shepherdjerred/streambot/web/server/selections.ts";
import { WebError } from "@shepherdjerred/streambot/web/server/errors.ts";

test("one viewer cannot evict another viewer's media references", () => {
  const selections = new Selections<string>();
  const alice = selections.add("alice", "Arrival", 0);
  const bob = selections.add("bob", "old search", 0);
  let latest = bob;
  for (let index = 0; index < 2500; index += 1)
    latest = selections.add("bob", "new search", 1);
  expect(selections.get("alice", alice, 2)).toBe("Arrival");
  expect(selections.get("bob", latest, 2)).toBe("new search");
  expect(() => selections.get("bob", bob, 2)).toThrow("expired");
  expect(() => selections.get("bob", alice, 2)).toThrow("expired");
});

test("capacity denies a new owner without invalidating active owners and expiry frees capacity", () => {
  const selections = new Selections<number>(100);
  const first = selections.add("owner-0", 0, 0);
  for (let index = 1; index < 2000; index += 1)
    selections.add("owner-" + String(index), index, 0);
  expect(() => selections.add("overflow", 1, 1)).toThrow(WebError);
  try {
    selections.add("overflow", 1, 1);
  } catch (error) {
    expect(error).toMatchObject({ status: 429, code: "selection_capacity" });
  }
  expect(selections.get("owner-0", first, 1)).toBe(0);
  const newest = selections.add("owner-0", 5, 50);
  const admitted = selections.add("overflow", 2, 100);
  expect(selections.get("overflow", admitted, 100)).toBe(2);
  expect(selections.get("owner-0", newest, 100)).toBe(5);
  expect(() => selections.get("owner-0", first, 100)).toThrow("expired");
});
