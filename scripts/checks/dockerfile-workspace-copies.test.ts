import { describe, expect, test } from "vitest";
import {
  buildEntrypoints,
  copyCoversPackage,
  missingPackageCopies,
  parseDockerfile,
} from "./dockerfile-workspace-copies.ts";

const DOCKERFILE = `
FROM oven/bun AS deps
COPY packages/toolkit/package.json ./packages/toolkit/package.json
FROM deps AS build
COPY --parents packages/toolkit packages/mc-harness/src/protocol ./
RUN bun build packages/toolkit/src/index.ts --target=bun
RUN cd packages/toolkit && bun build ./src/index.ts --compile
`;

describe("dockerfile workspace copies", () => {
  test("parses a build entry across cd and flags", () => {
    const stages = parseDockerfile(DOCKERFILE);
    expect(stages.map((stage) => stage.name)).toEqual(["deps", "build"]);
    expect(buildEntrypoints(stages[1]?.runs[0] ?? "")).toEqual([
      "packages/toolkit/src/index.ts",
    ]);
    expect(buildEntrypoints(stages[1]?.runs[1] ?? "")).toEqual([
      "packages/toolkit/src/index.ts",
    ]);
  });

  test("a package.json copy does not cover the package source", () => {
    expect(
      copyCoversPackage(["packages/toolkit/package.json"], "packages/toolkit"),
    ).toBe(false);
    expect(
      copyCoversPackage(
        ["packages/mc-harness/src/protocol"],
        "packages/mc-harness",
      ),
    ).toBe(true);
  });

  test("reports a workspace package the build stage never copies", () => {
    expect(
      missingPackageCopies(DOCKERFILE, "build", [
        "packages/toolkit",
        "packages/mc-harness",
        "packages/unix-socket-daemon",
      ]),
    ).toEqual(["packages/unix-socket-daemon"]);
  });
});
