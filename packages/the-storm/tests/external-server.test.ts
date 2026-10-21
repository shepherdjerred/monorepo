import { describe, expect, it } from "vitest";
import { parseExternalServer } from "#e2e/harness/external/inputs.ts";

const server = {
  STORM_E2E_HOST: "storm-qualify-e2e.mc-sandbox.svc",
  STORM_E2E_GAME_PORT: "25565",
  STORM_E2E_RCON_PORT: "25575",
  STORM_E2E_RCON_PASSWORD: "qualification-rcon-password",
  STORM_E2E_BRAIN_HOST: "storm-qualify-e2e.mc-sandbox.svc",
  STORM_E2E_BRAIN_PORT: "18081",
};
const http = {
  STORM_E2E_FILES_URL: "http://storm-qualify-e2e.mc-sandbox.svc:18082",
  STORM_E2E_FILES_TOKEN: "qualification-files-token",
};
// The Woodpecker smoke lane's sidecar declaration (storm-e2e.ts).
const shared = {
  STORM_E2E_LOG_FILE: "/woodpecker/data/logs/latest.log",
  STORM_E2E_STORM_DATA_DIR: "/woodpecker/sidecar-plugins/TheStorm",
};

function problems(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the declaration to be refused");
}

describe("external Paper server inputs", () => {
  it("accepts an in-cluster server with the files service", () => {
    const parsed = parseExternalServer({ ...server, ...http }, "e2e");
    expect(parsed).toEqual({
      server: {
        kind: "external",
        host: "storm-qualify-e2e.mc-sandbox.svc",
        gamePort: 25_565,
        rconPort: 25_575,
        rconPassword: "qualification-rcon-password",
        queryPort: null,
        files: {
          kind: "http",
          url: "http://storm-qualify-e2e.mc-sandbox.svc:18082",
          token: "qualification-files-token",
        },
      },
      brain: { host: "storm-qualify-e2e.mc-sandbox.svc", port: 18_081 },
    });
  });

  it("keeps the CI smoke lane's shared-folder declaration valid", () => {
    const parsed = parseExternalServer(
      { ...server, ...shared, STORM_E2E_BRAIN_TOKEN: "unused-by-runner" },
      "e2e",
    );
    expect(parsed.server.files).toEqual({
      kind: "shared",
      logFile: shared.STORM_E2E_LOG_FILE,
      stormDataDir: shared.STORM_E2E_STORM_DATA_DIR,
    });
  });

  it("requires the Query port for the all-module profile", () => {
    expect(
      problems(() => parseExternalServer({ ...server, ...http }, "full")),
    ).toContain("- STORM_E2E_QUERY_PORT is required");
    expect(
      parseExternalServer(
        { ...server, ...http, STORM_E2E_QUERY_PORT: "25565" },
        "full",
      ).server.queryPort,
    ).toBe(25_565);
  });

  it("names every missing input at once", () => {
    const message = problems(() =>
      parseExternalServer({ STORM_E2E_HOST: "paper" }, "full"),
    );
    for (const name of [
      "STORM_E2E_GAME_PORT",
      "STORM_E2E_RCON_PORT",
      "STORM_E2E_RCON_PASSWORD",
      "STORM_E2E_BRAIN_HOST",
      "STORM_E2E_BRAIN_PORT",
      "STORM_E2E_QUERY_PORT",
    ])
      expect(message).toContain(`- ${name} is required`);
    expect(message).toContain("A server file transport is required");
    expect(message).not.toContain("STORM_E2E_HOST is required");
  });

  it("refuses malformed and half-declared inputs", () => {
    const message = problems(() =>
      parseExternalServer(
        {
          ...server,
          STORM_E2E_GAME_PORT: "70000",
          STORM_E2E_RCON_PASSWORD: "short",
          STORM_E2E_FILES_URL: "ftp://paper:18082",
        },
        "e2e",
      ),
    );
    expect(message).toContain("STORM_E2E_GAME_PORT is invalid");
    expect(message).toContain("STORM_E2E_RCON_PASSWORD is invalid");
    expect(message).toContain("STORM_E2E_FILES_URL is invalid");
    expect(message).toContain("- STORM_E2E_FILES_TOKEN is required");
  });

  it("refuses two file transports and the capacity profile", () => {
    expect(
      problems(() =>
        parseExternalServer({ ...server, ...http, ...shared }, "e2e"),
      ),
    ).toContain("Declare one server file transport");
    expect(
      problems(() => parseExternalServer({ ...server, ...http }, "capacity")),
    ).toContain("capacity profile");
  });
});
