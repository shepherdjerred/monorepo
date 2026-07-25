/**
 * End-to-end test of the RBAC gate over the REAL HTTP boundary: the same
 * `fetchRequestHandler` + `createContext` the server mounts, driven with real
 * `scout_session` / `scout_csrf` cookies. Unlike the createCaller integration
 * test, this exercises cookie parsing, JWT session verification, the DB user
 * lookup, and the `errorFormatter` — i.e. the exact on-the-wire contract the SPA
 * consumes, including `error.data.missingPermission`.
 *
 * Only Discord is stubbed (via the offline harness); everything else is real.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  PermissionSchema,
  permissionKey,
} from "@scout-for-lol/data";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import configuration from "#src/configuration.ts";

const trpc = await createOfflineTrpcHarness("rbac-http-e2e");
// Import AFTER the harness installs its module mocks so createContext binds to
// the mocked prisma + Discord seams.
const { createContext } = await import("#src/trpc/context.ts");
const { signSession } = await import("#src/trpc/jwt.ts");
const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");

const guildId = DiscordGuildIdSchema.parse("100000000000009101");
const member = DiscordAccountIdSchema.parse("900000000000009101");

// tRPC single-procedure response envelopes (ts-reset makes .json() unknown, so
// validate rather than cast).
const OkSchema = z.object({ result: z.object({ data: z.unknown() }) });
const ErrSchema = z.object({
  error: z.object({
    data: z.object({
      code: z.string(),
      missingPermission: PermissionSchema.nullable(),
    }),
  }),
});

const handle = (request: Request): Promise<Response> =>
  fetchRequestHandler({
    endpoint: "/trpc",
    req: request,
    router: trpc.appRouter,
    createContext: () => createContext(request),
  });

let cookie = "";

async function query(proc: string, input?: unknown): Promise<Response> {
  const suffix =
    input === undefined
      ? ""
      : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  return handle(
    new Request(`http://localhost/trpc/${proc}${suffix}`, {
      headers: cookie ? { cookie } : {},
    }),
  );
}

async function mutate(proc: string, input: unknown): Promise<Response> {
  return handle(
    new Request(`http://localhost/trpc/${proc}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "csrf",
        // Same-origin check: match the configured web app origin when set.
        ...(configuration.webAppOrigin === undefined
          ? {}
          : { origin: configuration.webAppOrigin }),
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(input),
    }),
  );
}

afterAll(async () => {
  await trpc.prisma.$disconnect();
});

describe("RBAC over HTTP", () => {
  test("seeds a member with subscriptions:read and mints a session", async () => {
    await trpc.prisma.user.create({
      data: {
        discordId: member,
        discordUsername: "e2e",
        discordAvatar: null,
        discordAccessToken: null,
        discordRefreshToken: null,
        tokenExpiresAt: null,
      },
    });
    await trpc.prisma.serverPermission.create({
      data: {
        serverId: guildId,
        discordUserId: member,
        permission: permissionKey({
          resource: "subscriptions",
          action: "read",
        }),
        grantedBy: member,
        grantedAt: new Date(),
      },
    });
    trpc.setMembership([{ guildId, asAdmin: false }]);
    const { jwt } = await signSession({ discordId: member });
    cookie = `scout_session=${jwt}; scout_csrf=csrf`;
    expect(jwt.length).toBeGreaterThan(20);
  });

  test("authenticated session resolves over HTTP (auth.meWeb)", async () => {
    const res = await query("auth.meWeb");
    expect(res.status).toBe(200);
    const body = OkSchema.parse(await res.json());
    const me = z.object({ discordId: z.string() }).parse(body.result.data);
    expect(me.discordId).toBe(member);
  });

  test("a granted read returns 200 over HTTP", async () => {
    const res = await query("subscription.list", { guildId });
    expect(res.status).toBe(200);
    const body = OkSchema.parse(await res.json());
    const list = z
      .object({ items: z.array(z.unknown()) })
      .parse(body.result.data);
    expect(list.items).toEqual([]);
  });

  test("a denied write returns 403 with the missing permission on the wire", async () => {
    const res = await mutate("subscription.add", {
      guildId,
      channelId: "111111111111111111",
      region: "AMERICA_NORTH",
      riotId: "abc#na1",
      alias: "x",
    });
    expect(res.status).toBe(403);
    const body = ErrSchema.parse(await res.json());
    expect(body.error.data.code).toBe("FORBIDDEN");
    // The exact contract packages/app/forbidden-panel.tsx reads:
    expect(body.error.data.missingPermission).toEqual({
      resource: "subscriptions",
      action: "create",
    });
  });

  test("anonymous request is rejected over HTTP", async () => {
    cookie = "";
    const res = await query("subscription.list", { guildId });
    const body = ErrSchema.parse(await res.json());
    expect(body.error.data.code).toBe("UNAUTHORIZED");
  });
});
