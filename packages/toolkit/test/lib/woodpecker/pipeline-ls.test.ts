import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  handleWoodpeckerPipelineLsJson,
  isWoodpeckerPipelineLsJson,
} from "#lib/woodpecker/pipeline-ls.ts";

describe("isWoodpeckerPipelineLsJson", () => {
  test("identifies woodpecker pipeline ls with --output json", () => {
    expect(
      isWoodpeckerPipelineLsJson("woodpecker", [
        "pipeline",
        "ls",
        "shepherdjerred/monorepo",
        "--output",
        "json",
      ]),
    ).toBe(true);
  });

  test("identifies woodpecker pipeline ls with --output=json", () => {
    expect(
      isWoodpeckerPipelineLsJson("woodpecker", [
        "pipeline",
        "ls",
        "--output=json",
      ]),
    ).toBe(true);
  });

  test("identifies woodpecker pipeline ls with --json", () => {
    expect(
      isWoodpeckerPipelineLsJson("woodpecker", ["pipeline", "ls", "--json"]),
    ).toBe(true);
  });

  test("ignores woodpecker pipeline ls with non-json output or table", () => {
    expect(
      isWoodpeckerPipelineLsJson("woodpecker", [
        "pipeline",
        "ls",
        "shepherdjerred/monorepo",
      ]),
    ).toBe(false);
    expect(
      isWoodpeckerPipelineLsJson("woodpecker", [
        "pipeline",
        "ls",
        "--output",
        "table",
      ]),
    ).toBe(false);
  });

  test("ignores non-woodpecker commands", () => {
    expect(
      isWoodpeckerPipelineLsJson("gh", ["pipeline", "ls", "--output", "json"]),
    ).toBe(false);
  });
});

describe("handleWoodpeckerPipelineLsJson", () => {
  test("queries API and outputs JSON", async () => {
    const origToken = Bun.env["WOODPECKER_TOKEN"];
    const origUrl = Bun.env["WOODPECKER_URL"];
    Bun.env["WOODPECKER_TOKEN"] = "mock-token";
    Bun.env["WOODPECKER_URL"] = "https://woodpecker.example.com";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Suppress console output in test
    });
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: URL | string) => {
          const u = new URL(url);
          if (u.pathname === "/api/repos/1/pipelines") {
            return Response.json([
              { id: 100, number: 1, status: "success" },
              { id: 99, number: 2, status: "failure" },
            ]);
          }
          return new Response("Not found", { status: 404 });
        }),
      );

      await handleWoodpeckerPipelineLsJson([
        "pipeline",
        "ls",
        "1",
        "--limit",
        "1",
        "--output",
        "json",
      ]);

      expect(logSpy).toHaveBeenCalled();
      const firstCall = logSpy.mock.calls[0];
      const rawOutput = firstCall === undefined ? undefined : firstCall[0];
      expect(typeof rawOutput).toBe("string");
      const output = z
        .array(z.object({ id: z.number() }))
        .parse(JSON.parse(typeof rawOutput === "string" ? rawOutput : "[]"));
      expect(output).toHaveLength(1);
      expect(output[0]?.id).toBe(100);
    } finally {
      if (origToken === undefined) {
        delete Bun.env["WOODPECKER_TOKEN"];
      } else {
        Bun.env["WOODPECKER_TOKEN"] = origToken;
      }
      if (origUrl === undefined) {
        delete Bun.env["WOODPECKER_URL"];
      } else {
        Bun.env["WOODPECKER_URL"] = origUrl;
      }
      vi.unstubAllGlobals();
      logSpy.mockRestore();
    }
  });
});
