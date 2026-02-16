import { latestVersion } from "@scout-for-lol/data/data-dragon/version";
import { test, expect } from "bun:test";

test("should be able to get version", () => {
  expect(latestVersion).toMatchSnapshot();
});
