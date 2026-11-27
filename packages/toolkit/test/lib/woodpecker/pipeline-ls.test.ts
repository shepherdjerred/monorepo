import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  handleWoodpeckerPipelineLsJson,
  handleWoodpeckerPipelineShowJson,
  isWoodpeckerPipelineLsJson,
  isWoodpeckerPipelineShowJson,
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

async function withMockWoodpeckerApi(
  handler: (url: URL) => Response,
  runTest: (outputs: string[]) => Promise<void>,
): Promise<void> {
  const origToken = Bun.env["WOODPECKER_TOKEN"];
  const origUrl = Bun.env["WOODPECKER_URL"];
  Bun.env["WOODPECKER_TOKEN"] = "mock-token";
  Bun.env["WOODPECKER_URL"] = "https://woodpecker.example.com";
  const outputs: string[] = [];
  const logSpy = vi
    .spyOn(console, "log")
    .mockImplementation((line: unknown) => {
      outputs.push(String(line));
    });
  try {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => handler(new URL(url))),
    );
    await runTest(outputs);
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
}

describe("handleWoodpeckerPipelineLsJson", () => {
  test("queries API and outputs JSON", async () => {
    await withMockWoodpeckerApi(
      (u) => {
        if (u.pathname === "/api/repos/1/pipelines") {
          return Response.json([
            { id: 100, number: 1, status: "success" },
            { id: 99, number: 2, status: "failure" },
          ]);
        }
        return new Response("Not found", { status: 404 });
      },
      async (outputs) => {
        await handleWoodpeckerPipelineLsJson([
          "pipeline",
          "ls",
          "1",
          "--limit",
          "1",
          "--output",
          "json",
        ]);

        expect(outputs.length).toBeGreaterThan(0);
        const output = z
          .array(z.object({ id: z.number() }))
          .parse(JSON.parse(outputs[0] ?? "[]"));
        expect(output).toHaveLength(1);
        expect(output[0]?.id).toBe(100);
      },
    );
  });
});

describe("isWoodpeckerPipelineShowJson", () => {
  test.each([
    [
      "pipeline",
      "show",
      "shepherdjerred/monorepo",
      "16208",
      "--output",
      "json",
    ],
    ["pipeline", "show", "shepherdjerred/monorepo", "16208", "--output=json"],
    ["pipeline", "show", "shepherdjerred/monorepo", "16208", "-o", "json"],
    ["pipeline", "show", "shepherdjerred/monorepo", "16208", "-o=json"],
    ["pipeline", "show", "shepherdjerred/monorepo", "16208", "-ojson"],
    ["pipeline", "show", "1", "16208", "--json"],
    [
      "--server",
      "https://woodpecker.example.com",
      "pipeline",
      "show",
      "1",
      "16208",
      "--output",
      "json",
    ],
  ])("identifies woodpecker pipeline show JSON invocation %#", (...args) => {
    expect(isWoodpeckerPipelineShowJson("woodpecker", args)).toBe(true);
  });

  test("ignores non-json, help, and non-show invocations", () => {
    expect(
      isWoodpeckerPipelineShowJson("woodpecker", [
        "pipeline",
        "show",
        "shepherdjerred/monorepo",
        "16208",
      ]),
    ).toBe(false);
    expect(
      isWoodpeckerPipelineShowJson("woodpecker", [
        "pipeline",
        "show",
        "shepherdjerred/monorepo",
        "16208",
        "--output",
        "table",
      ]),
    ).toBe(false);
    expect(
      isWoodpeckerPipelineShowJson("woodpecker", [
        "pipeline",
        "show",
        "--help",
        "--output",
        "json",
      ]),
    ).toBe(false);
    expect(
      isWoodpeckerPipelineShowJson("woodpecker", [
        "pipeline",
        "ls",
        "--output",
        "json",
      ]),
    ).toBe(false);
    expect(
      isWoodpeckerPipelineShowJson("gh", [
        "pipeline",
        "show",
        "1",
        "16208",
        "--output",
        "json",
      ]),
    ).toBe(false);
    expect(
      isWoodpeckerPipelineShowJson("woodpecker", [
        "pipeline",
        "show",
        "1",
        "16208",
        "--",
        "--output",
        "json",
      ]),
    ).toBe(false);
  });
});

describe("handleWoodpeckerPipelineShowJson", () => {
  test("resolves owner/repo or numeric repo ID and prints pipeline JSON (AI-538)", async () => {
    const seenPaths: string[] = [];
    await withMockWoodpeckerApi(
      (u) => {
        seenPaths.push(u.pathname);
        if (u.pathname === "/api/repos/lookup/shepherdjerred/monorepo") {
          return Response.json({ id: 7 });
        }
        if (
          u.pathname === "/api/repos/7/pipelines/16208" ||
          u.pathname === "/api/repos/1/pipelines/16209"
        ) {
          return Response.json({
            id: 500,
            number: u.pathname.endsWith("16208") ? 16_208 : 16_209,
            status: "failure",
            branch: "main",
          });
        }
        return new Response("Not found", { status: 404 });
      },
      async (outputs) => {
        await handleWoodpeckerPipelineShowJson([
          "pipeline",
          "show",
          "shepherdjerred/monorepo",
          "16208",
          "--output",
          "json",
        ]);
        await handleWoodpeckerPipelineShowJson([
          "pipeline",
          "show",
          "16209",
          "--json",
        ]);

        expect(seenPaths).toEqual([
          "/api/repos/lookup/shepherdjerred/monorepo",
          "/api/repos/7/pipelines/16208",
          "/api/repos/1/pipelines/16209",
        ]);
        expect(JSON.parse(outputs[0] ?? "{}")).toMatchObject({
          number: 16_208,
          status: "failure",
          branch: "main",
        });
        expect(JSON.parse(outputs[1] ?? "{}")).toMatchObject({
          number: 16_209,
          status: "failure",
        });

        await expect(
          handleWoodpeckerPipelineShowJson([
            "pipeline",
            "show",
            "shepherdjerred/monorepo",
            "--output",
            "json",
          ]),
        ).rejects.toThrow("Usage: toolkit woodpecker pipeline show");
        await expect(
          handleWoodpeckerPipelineShowJson([
            "pipeline",
            "show",
            "1",
            "0",
            "--output",
            "json",
          ]),
        ).rejects.toThrow("Invalid Woodpecker pipeline number: 0");
      },
    );
  });
});
