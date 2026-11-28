import { expect, test } from "vitest";
import { resolveFlagsMachineToken } from "#handlers/flags/index.ts";
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
  let actor: string | null = "unset";
  const { io, text } = capture(async (input, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    actor = new Headers(init?.headers).get("x-flags-actor");
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
  expect(actor).toBeNull();
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

test("human apply sends the service origin and no login or token", async () => {
  let authorization: string | null = "unset";
  let origin: string | null = null;
  let login: string | null = null;
  const { io, text } = capture(async (_input, init) => {
    const headers = new Headers(init?.headers);
    authorization = headers.get("authorization");
    origin = headers.get("origin");
    login = headers.get("tailscale-user-login");
    return jsonResponse(200, { revision: 5 });
  });
  const code = await runFlags(["apply"], io, {
    json: false,
    file: "reviewed.json",
  });
  expect(code).toBe(0);
  expect(authorization).toBeNull();
  expect(origin).toBe("https://flags.example.test");
  expect(login).toBeNull();
  expect(text()).toBe("revised to 5");
});

test("apply conflict exits 2 and does not print the machine token", async () => {
  let authorization = "";
  let actor: string | null = null;
  const { io, text } = capture(async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    actor = new Headers(init?.headers).get("x-flags-actor");
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
  expect(actor).toBe("toolkit");
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

test("diff names invalid live values and their schema issues", async () => {
  const invalid = capture(async () =>
    jsonResponse(200, {
      deployments: [
        {
          id: "delivery/prod",
          missing: [],
          extra: [],
          drift: [{ key: "delivery-lease-seconds" }],
          invalid: [
            {
              key: "delivery-lease-seconds",
              value: "30",
              issues: [
                { path: "", message: "Too small: expected number to be >=60" },
              ],
            },
            {
              key: "delivery-enabled-environments",
              value: '["a",""]',
              issues: [{ path: "/1", message: "Too small" }],
            },
          ],
        },
      ],
    }),
  );
  expect(
    await runFlags(["diff"], invalid.io, { json: false, file: undefined }),
  ).toBe(1);
  expect(invalid.text()).toBe(
    [
      "delivery/prod\tmissing 0\textra 0\tdrift delivery-lease-seconds\tinvalid delivery-lease-seconds,delivery-enabled-environments",
      "  delivery-lease-seconds: Too small: expected number to be >=60",
      "  delivery-enabled-environments /1: Too small",
    ].join("\n"),
  );
  const onlyInvalid = capture(async () =>
    jsonResponse(200, {
      deployments: [
        {
          id: "delivery/prod",
          missing: [],
          extra: [],
          drift: [],
          invalid: [
            {
              key: "delivery-lease-seconds",
              value: "30",
              issues: [{ path: "", message: "Too small" }],
            },
          ],
        },
      ],
    }),
  );
  expect(
    await runFlags(["diff"], onlyInvalid.io, { json: true, file: undefined }),
  ).toBe(1);
});

test("apply prints each refused value and writes nothing", async () => {
  const { io, text } = capture(async () =>
    jsonResponse(400, {
      error: "invalid flag values",
      issues: [
        {
          key: "delivery-lease-seconds",
          path: "",
          message: "Too small: expected number to be >=60",
        },
        { key: "mail-settings", path: "/retentionDays", message: "Too small" },
      ],
    }),
  );
  const code = await runFlags(["apply"], io, {
    json: false,
    file: "reviewed.json",
  });
  expect(code).toBe(1);
  expect(text()).toBe(
    [
      "invalid flag values; nothing was written:",
      "  delivery-lease-seconds: Too small: expected number to be >=60",
      "  mail-settings /retentionDays: Too small",
    ].join("\n"),
  );
});

test("--machine resolves FLAGS_MACHINE_TOKEN through the broker when unset", async () => {
  const saved = Bun.env["FLAGS_MACHINE_TOKEN"];
  try {
    Reflect.deleteProperty(Bun.env, "FLAGS_MACHINE_TOKEN");
    const calls: (readonly string[])[] = [];
    const resolved = await resolveFlagsMachineToken(true, async (names) => {
      calls.push(names);
      Bun.env["FLAGS_MACHINE_TOKEN"] = "brokered-flags-token";
    });
    expect(calls).toEqual([["FLAGS_MACHINE_TOKEN"]]);
    expect(resolved).toBe("brokered-flags-token");

    const second = await resolveFlagsMachineToken(true, async () => {
      throw new Error("ambient token must skip broker");
    });
    expect(second).toBe("brokered-flags-token");
    expect(await resolveFlagsMachineToken(false)).toBeUndefined();
  } finally {
    if (saved === undefined) {
      Reflect.deleteProperty(Bun.env, "FLAGS_MACHINE_TOKEN");
    } else {
      Bun.env["FLAGS_MACHINE_TOKEN"] = saved;
    }
  }
});
