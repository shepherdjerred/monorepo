import { summoner } from "@scout-for-lol/data/data-dragon/summoner";
import { test, expect } from "bun:test";

test("should be able to get champion data", () => {
  expect(summoner).toMatchSnapshot();
});
