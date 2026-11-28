import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildEntrypoints,
  copyCoversPackage,
  dockerfileCopyProblems,
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

  test("reports workspace sources reached through private package imports", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "docker-workspace-copies-"));
    const dockerfile = path.join(root, "Dockerfile");
    const build = `FROM oven/bun AS build
COPY --parents packages/cli ./
RUN cd packages/cli && bun build src/index.ts --compile
`;
    try {
      await Promise.all([
        Bun.write(dockerfile, build),
        Bun.write(
          path.join(root, "package.json"),
          JSON.stringify({ workspaces: ["packages/cli", "packages/contract"] }),
        ),
        Bun.write(
          path.join(root, "packages/cli/package.json"),
          JSON.stringify({ name: "cli", imports: { "#lib/*": "./src/lib/*" } }),
        ),
        Bun.write(
          path.join(root, "packages/cli/src/index.ts"),
          'void import("./handler.ts");',
        ),
        Bun.write(
          path.join(root, "packages/cli/src/handler.ts"),
          'import "#lib/client.ts";',
        ),
        Bun.write(
          path.join(root, "packages/cli/src/lib/client.ts"),
          'import "@example/contract";',
        ),
        Bun.write(
          path.join(root, "packages/contract/package.json"),
          JSON.stringify({ name: "@example/contract" }),
        ),
        Bun.write(
          path.join(root, "packages/contract/src/index.ts"),
          "export {};",
        ),
      ]);

      expect(await dockerfileCopyProblems(root)).toEqual([
        `${dockerfile}: build bun build packages/cli/src/index.ts does not copy packages/contract`,
      ]);

      await Bun.write(
        dockerfile,
        build.replace(
          "packages/cli ./",
          "packages/cli packages/contract/src ./",
        ),
      );
      expect(await dockerfileCopyProblems(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
