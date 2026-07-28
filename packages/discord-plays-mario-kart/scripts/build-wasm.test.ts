import { expect, test } from "bun:test";
import { parseN64Upstream } from "./upstream.ts";

test("validates the Docker image and immutable source pin", () => {
  expect(() =>
    parseN64Upstream({
      repository: "https://example.com",
      branch: "main",
      commit: "main",
      emsdkImage: "latest",
    }),
  ).toThrow("Invalid");
});
