import { afterEach, expect, test, vi } from "vitest";
import { WebDiscordContext } from "@shepherdjerred/streambot/discord/web-context.ts";
import { GUILD, USER, webFixture } from "./web-fixture.ts";

let fixture: ReturnType<typeof webFixture> | undefined;
async function status(request: Request) {
  if (fixture === undefined) throw new Error("Missing fixture");
  const response = await fixture.handler(request);
  return response.status;
}
afterEach(() => {
  fixture?.close();
  fixture = undefined;
  vi.restoreAllMocks();
});

test("abandoned OAuth starts cannot exhaust sign-in; signed states reject tampering, expiry and replay", async () => {
  fixture = webFixture();
  const startUrl = "http://127.0.0.1:8080/api/auth/discord/start";
  const start = await fixture.handler(new Request(startUrl));
  const state = new URL(start.headers.get("location") ?? "").searchParams.get(
    "state",
  );
  if (state === null) throw new Error("Missing state");
  const cookie = start.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  for (let index = 0; index < 1100; index += 1)
    expect(await status(new Request(startUrl))).toBe(302);
  const callback =
    "http://127.0.0.1:8080/api/auth/discord/callback?code=fixture&state=";
  const altered = "0" + state;
  expect(
    await status(
      new Request(callback + altered, {
        headers: { cookie: "streambot_oauth_state=" + altered },
      }),
    ),
  ).toBe(400);
  expect(
    await status(new Request(callback + state, { headers: { cookie } })),
  ).toBe(302);
  expect(
    await status(new Request(callback + state, { headers: { cookie } })),
  ).toBe(400);
  const fresh = await fixture.handler(new Request(startUrl));
  const freshState = new URL(
    fresh.headers.get("location") ?? "",
  ).searchParams.get("state");
  const freshCookie = fresh.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const later = Date.now() + 300_001;
  vi.spyOn(Date, "now").mockReturnValue(later);
  expect(
    await status(
      new Request(callback + String(freshState), {
        headers: { cookie: freshCookie },
      }),
    ),
  ).toBe(400);
});

test("poster browsing cannot consume the command budget and both budgets remain bounded", async () => {
  fixture = webFixture();
  await fixture.seed();
  const poster =
    "http://127.0.0.1:8080/api/artwork?guildId=" + GUILD + "&id=expired";
  for (let index = 0; index < 600; index += 1)
    expect(
      await status(
        new Request(poster, { headers: { cookie: fixture.cookie } }),
      ),
    ).not.toBe(429);
  expect(
    await status(new Request(poster, { headers: { cookie: fixture.cookie } })),
  ).toBe(429);
  expect(await status(fixture.command({ action: "pause" }))).toBe(200);
  for (let index = 0; index < 119; index += 1)
    expect(
      await status(
        new Request("http://127.0.0.1:8080/api/me", {
          headers: { cookie: fixture.cookie },
        }),
      ),
    ).toBe(200);
  expect(await status(fixture.command({ action: "stop" }))).toBe(429);
});

test("a snapshot captures the queue and revision after asynchronous feature checks", async () => {
  fixture = webFixture();
  await fixture.seed();
  const active = fixture;
  vi.spyOn(
    fixture.playback.deps.featureGate,
    "assistantV2",
  ).mockImplementationOnce(() => {
    active.handle.dispatch({
      type: "ADD",
      source: { kind: "search", query: "new queue item" },
      requesterId: USER,
    });
    return Promise.resolve(true);
  });
  const snapshot = await fixture.playback.snapshot(fixture.session, GUILD);
  expect(snapshot.queue).toHaveLength(1);
  expect(snapshot.revision).toBe(fixture.revision());
});

function membershipFixture() {
  const fetchMember = vi.fn(() => Promise.resolve({}));
  const context = new WebDiscordContext({
    isReady: () => true,
    application: { id: "fixture" },
    guilds: {
      cache: new Map([
        [
          GUILD,
          {
            id: GUILD,
            name: "Fixture",
            members: { fetch: fetchMember },
            voiceStates: { cache: new Map() },
            channels: { cache: new Map() },
          },
        ],
      ]),
    },
  });
  return { context, fetchMember };
}

test("concurrent membership checks coalesce but subsequent reads fetch current membership", async () => {
  const { context, fetchMember } = membershipFixture();
  expect(
    await Promise.all(
      Array.from({ length: 50 }, () => context.webVerifyMember(GUILD, USER)),
    ),
  ).toEqual(Array.from({ length: 50 }, () => true));
  expect(fetchMember).toHaveBeenCalledTimes(1);
  expect(await context.webVerifyMember(GUILD, USER)).toBe(true);
  expect(fetchMember).toHaveBeenCalledTimes(2);
});

test("membership loss is checked without a privileged gateway event and unknown members are not cached", async () => {
  const { context, fetchMember } = membershipFixture();
  expect(await context.webVerifyMember(GUILD, USER)).toBe(true);
  fetchMember.mockRejectedValueOnce(
    Object.assign(new Error("Unknown member"), { code: 10_007 }),
  );
  expect(await context.webVerifyMember(GUILD, USER)).toBe(false);
  expect(await context.webVerifyMember(GUILD, USER)).toBe(true);
  expect(fetchMember).toHaveBeenCalledTimes(3);
});

test("Discord membership errors propagate and the next request retries", async () => {
  const { context, fetchMember } = membershipFixture();
  fetchMember.mockRejectedValueOnce(new Error("Discord unavailable"));
  await expect(context.webVerifyMember(GUILD, USER)).rejects.toThrow(
    "Discord unavailable",
  );
  expect(await context.webVerifyMember(GUILD, USER)).toBe(true);
  expect(fetchMember).toHaveBeenCalledTimes(2);
});
