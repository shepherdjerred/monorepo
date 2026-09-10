import { describe, expect, test, vi } from "vitest";
import {
  assertInvocationAllowed,
  DiscordSmokeFixtureSchema,
  DiscordSmokeManifestSchema,
  preflightDiscordSmoke,
  raceRuntimeOperation,
  waitForRuntimeReadiness,
  waitForDiscordCommand,
} from "./discord-smoke-core.ts";

const fixture = DiscordSmokeFixtureSchema.parse({
  applicationId: "1542993271477899294",
  botUserId: "1542993271477899294",
  invokingUserId: "1515150733660520496",
  recipientUserId: "160509172704739328",
  guildId: "100000000000000001",
  channelId: "100000000000000002",
  pinchTabProfile: "scout-discord-smoke",
});

function response(body: unknown): Response {
  return Response.json(body);
}

function neverSettles<Value>(): Promise<Value> {
  return new Promise(() => {
    // Deliberately pending so the competing runtime-exit promise wins.
  });
}

test("preflight validates both identities, guild/channel access, app, and profile", async () => {
  const fetcher = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const authorization = new Headers(init?.headers).get("authorization");
    if (url.endsWith("/users/@me")) {
      return Promise.resolve(
        response({
          id:
            authorization?.startsWith("Bot ") === true
              ? fixture.botUserId
              : fixture.invokingUserId,
        }),
      );
    }
    if (url.endsWith("/users/@me/guilds")) {
      return Promise.resolve(response([{ id: fixture.guildId }]));
    }
    if (url.includes("/channels/")) {
      return Promise.resolve(
        response({ id: fixture.channelId, guild_id: fixture.guildId }),
      );
    }
    if (url.includes("/members/")) {
      return Promise.resolve(
        response({ user: { id: fixture.recipientUserId } }),
      );
    }
    return Promise.resolve(response({ id: fixture.applicationId }));
  });
  const verifyPinchTabProfile = vi.fn(() => Promise.resolve());

  await preflightDiscordSmoke(
    fixture,
    { DISCORD_BOT_TOKEN: "bot", DISCORD_USER_TOKEN: "user" },
    { fetch: fetcher, verifyPinchTabProfile },
  );

  expect(fetcher).toHaveBeenCalledTimes(8);
  expect(verifyPinchTabProfile).toHaveBeenCalledWith(
    "scout-discord-smoke",
    fixture.guildId,
    fixture.channelId,
  );
});

test("preflight refuses missing credentials before network or browser work", async () => {
  const fetcher = vi.fn(fetch);
  const verifyPinchTabProfile = vi.fn(() => Promise.resolve());

  await expect(
    preflightDiscordSmoke(
      fixture,
      {},
      {
        fetch: fetcher,
        verifyPinchTabProfile,
      },
    ),
  ).rejects.toThrow("DISCORD_BOT_TOKEN");
  expect(fetcher).not.toHaveBeenCalled();
  expect(verifyPinchTabProfile).not.toHaveBeenCalled();
});

describe("invocation guard", () => {
  const base = DiscordSmokeManifestSchema.parse({
    runId: "run-1",
    scenario: "bb-transfer",
    createdAt: "2026-08-29T00:00:00.000Z",
    databaseName: null,
    databaseUrl: null,
    seededAccounts: null,
    invocationStartedAt: null,
    privateReplyId: null,
    publicMessageId: null,
    verifiedAt: null,
    screenshotPath: null,
  });

  test("allows a pristine run", () => {
    expect(() => assertInvocationAllowed(base)).not.toThrow();
  });

  test("requires resume once invocation or any response is recorded", () => {
    expect(() =>
      assertInvocationAllowed({
        ...base,
        invocationStartedAt: "2026-08-29T00:01:00.000Z",
      }),
    ).toThrow("may not invoke again");
    expect(() =>
      assertInvocationAllowed({
        ...base,
        publicMessageId: "100000000000000009",
      }),
    ).toThrow("may not invoke again");
  });
});

describe("runtime readiness", () => {
  test("waits for a readiness file written by the spawned backend", async () => {
    let probes = 0;
    await waitForRuntimeReadiness(
      { exitCode: null, exited: neverSettles<number>() },
      "/tmp/scout-ready",
      1000,
      {
        fileExists: () => {
          probes += 1;
          return Promise.resolve(probes === 2);
        },
        now: () => 0,
        sleep: () => Promise.resolve(),
      },
    );
    expect(probes).toBe(2);
  });

  test("fails when the spawned runtime exits before readiness", async () => {
    await expect(
      waitForRuntimeReadiness(
        { exitCode: 12, exited: Promise.resolve(12) },
        "/tmp/scout-ready",
        1000,
        {
          fileExists: () => Promise.resolve(false),
          now: () => 0,
          sleep: () => neverSettles<undefined>(),
        },
      ),
    ).rejects.toThrow("exited with code 12");
  });

  test("fails if the runtime exits while another readiness check runs", async () => {
    await expect(
      raceRuntimeOperation(
        { exitCode: 7, exited: Promise.resolve(7) },
        neverSettles<undefined>(),
        "before command registration",
      ),
    ).rejects.toThrow("before command registration");
  });
});

test("waits for the exact registered subcommand", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response([{ id: "100000000000000010", name: "bb", options: [] }]),
    )
    .mockResolvedValueOnce(
      response([
        {
          id: "100000000000000010",
          name: "bb",
          options: [{ type: 1, name: "transfer" }],
        },
      ]),
    );

  await waitForDiscordCommand(
    {
      fixture,
      botToken: "bot",
      commandName: "bb",
      subcommandName: "transfer",
      guildScoped: true,
      timeoutMilliseconds: 2000,
    },
    fetcher,
  );

  expect(fetcher).toHaveBeenCalledTimes(2);
});
