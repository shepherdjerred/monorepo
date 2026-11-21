import { expect, test } from "vitest";
import { flagsBaseUrl, runFlags, type FlagsIo } from "#lib/flags/client.ts";

const TOKEN = "super-secret-token";

function capture(fetchImpl: FlagsIo["fetch"], token?: string) {
  const out: string[] = [];
  const err: string[] = [];
  const io: FlagsIo = {
    fetch: fetchImpl,
    stdout: (line) => {
      out.push(line);
    },
    stderr: (line) => {
      err.push(line);
    },
    readFile: async () =>
      JSON.stringify({
        deployment: "scout/prod",
        expectedRevision: 4,
        flags: [
          {
            type: "boolean",
            key: "dares_enabled",
            default: true,
            rollouts: [],
          },
        ],
      }),
    baseUrl: "https://flags.example.test",
    token,
  };
  return {
    io,
    text: () => [...out, ...err].join("\n"),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

test("rejects a flags URL that carries credentials", () => {
  expect(() => flagsBaseUrl("https://user:secret@flags.example.test")).toThrow(
    /credentials/u,
  );
  expect(flagsBaseUrl("https://flags.example.test/unused")).toBe(
    "https://flags.example.test",
  );
});

test("deployments --json prints the document list and sends no token", async () => {
  let authorization: string | null = "unset";
  const { io, text } = capture(async (input, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    expect(input.href).toBe("https://flags.example.test/v1/deployments");
    return jsonResponse(200, {
      deployments: [{ id: "scout/prod", revision: 1, flagCount: 2 }],
    });
  });
  const code = await runFlags(["deployments"], io, {
    json: true,
    file: undefined,
  });
  expect(code).toBe(0);
  expect(authorization).toBeNull();
  expect(text()).toContain("scout/prod");
  expect(text()).not.toContain(TOKEN);
});

test("get requires a deployment and a flag", async () => {
  const { io, text } = capture(async () => jsonResponse(500, { error: "no" }));
  const code = await runFlags(["get", "scout/prod"], io, {
    json: true,
    file: undefined,
  });
  expect(code).toBe(1);
  expect(text()).toContain("Usage:");
});

test("apply conflict exits 2 and does not print the machine token", async () => {
  let authorization = "";
  const { io, text } = capture(async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return jsonResponse(409, {
      error: "revision conflict",
      revision: 9,
      flags: [
        { type: "boolean", key: "dares_enabled", default: false, rollouts: [] },
      ],
    });
  }, TOKEN);
  const code = await runFlags(["apply"], io, {
    json: false,
    file: "reviewed.json",
  });
  expect(code).toBe(2);
  expect(authorization).toBe(`Bearer ${TOKEN}`);
  expect(text()).toContain("revision conflict at 9");
  expect(text()).not.toContain(TOKEN);
});

test("a clean diff exits 0 and a drifted diff exits 1", async () => {
  const clean = capture(async () =>
    jsonResponse(200, {
      deployments: [{ id: "scout/prod", missing: [], extra: [], drift: [] }],
    }),
  );
  expect(
    await runFlags(["diff"], clean.io, { json: true, file: undefined }),
  ).toBe(0);
  const drifted = capture(async () =>
    jsonResponse(200, {
      deployments: [
        {
          id: "scout/prod",
          missing: [],
          extra: [],
          drift: [{ key: "dares_enabled" }],
        },
      ],
    }),
  );
  expect(
    await runFlags(["diff"], drifted.io, { json: false, file: undefined }),
  ).toBe(1);
  expect(drifted.text()).toContain("dares_enabled");
});
