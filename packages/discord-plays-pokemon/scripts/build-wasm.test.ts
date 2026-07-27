import { expect, test } from "bun:test";
import { parsePokemonUpstream } from "./lib/upstream.ts";

test("requires an immutable upstream commit", () => {
  expect(() =>
    parsePokemonUpstream({
      repository: "https://example.com",
      branch: "main",
      commit: "main",
    }),
  ).toThrow("Invalid");
});

test("accepts a complete immutable upstream pin", () => {
  const upstream = {
    repository: "https://example.com/pokeemerald.git",
    branch: "master",
    commit: "0123456789abcdef0123456789abcdef01234567",
  };
  expect(parsePokemonUpstream(upstream)).toEqual(upstream);
});
