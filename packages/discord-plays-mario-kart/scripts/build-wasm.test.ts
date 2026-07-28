import { expect, test } from "bun:test";
import {
  extractEmsdkImageFromDockerfile,
  parseN64Upstream,
} from "./upstream.ts";

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

test("keeps the Emscripten image synchronized with the Docker build stage", async () => {
  const root = import.meta.dir.replace(/\/scripts$/, "");
  const upstream = parseN64Upstream(
    await Bun.file(`${root}/wasm-src/upstream.json`).json(),
  );
  const dockerfile = await Bun.file(`${root}/Dockerfile`).text();

  expect(extractEmsdkImageFromDockerfile(dockerfile)).toBe(upstream.emsdkImage);
});
