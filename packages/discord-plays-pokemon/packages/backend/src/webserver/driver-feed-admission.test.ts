import { expect, test } from "vitest";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { voiceAdmission } from "./driver-feed-admission.ts";
import {
  createSqliteSessionStore,
  SESSION_LIFETIME_SECONDS,
} from "@shepherdjerred/discord-plays-core/auth/session-store.ts";
import { cookieValue } from "@shepherdjerred/discord-plays-core/auth/discord-oauth.ts";

const USER = {
  discordId: "42",
  username: "trainer",
  name: "May",
  avatarUrl: null,
};
const ORIGIN = "https://pokebot.example.com";

test("feed requires the deployment origin, a session cookie, and current voice membership", async () => {
  let present = true;
  const admit = voiceAdmission({
    publicOrigin: ORIGIN,
    identify: (cookie) =>
      cookie === "pokemon_session=test" ? USER : undefined,
    policy: { canWatch: (user) => user !== undefined && present },
  });
  const network = new Socket();
  try {
    const request = new IncomingMessage(network);
    request.headers.origin = "https://other.example.com";
    request.headers.cookie = "pokemon_session=test";
    const crossOrigin = await admit(request);
    expect(crossOrigin.admitted).toBe(false);
    request.headers.origin = ORIGIN;
    delete request.headers.cookie;
    const signedOut = await admit(request);
    expect(signedOut.admitted).toBe(false);
    request.headers.cookie = "pokemon_session=test";
    const allowed = await admit(request);
    expect(allowed.admitted).toBe(true);
    if (!allowed.admitted) throw new Error("viewer was not admitted");
    expect(allowed.isStillAdmitted()).toBe(true);
    present = false;
    expect(allowed.isStillAdmitted()).toBe(false);
    const leftVoice = await admit(request);
    expect(leftVoice.admitted).toBe(false);
  } finally {
    network.destroy();
  }
});

test("an open feed loses admission when its SQLite session is deleted or expires", async () => {
  const store = createSqliteSessionStore(":memory:");
  let now = 1000;
  const token = await store.create(USER, now);
  const admit = voiceAdmission({
    publicOrigin: ORIGIN,
    identify: (cookie) => {
      const value = cookieValue(cookie, "pokemon_session");
      return value === undefined ? undefined : store.readSync(value, now);
    },
    policy: { canWatch: (user) => user !== undefined },
  });
  const network = new Socket();
  try {
    const request = new IncomingMessage(network);
    request.headers.origin = ORIGIN;
    request.headers.cookie = `pokemon_session=${token}`;
    const allowed = await admit(request);
    if (!allowed.admitted) throw new Error("viewer was not admitted");
    expect(allowed.isStillAdmitted()).toBe(true);
    await store.delete(token);
    expect(allowed.isStillAdmitted()).toBe(false);

    const expiringToken = await store.create(USER, now);
    request.headers.cookie = `pokemon_session=${expiringToken}`;
    const expiring = await admit(request);
    if (!expiring.admitted) throw new Error("viewer was not admitted");
    expect(expiring.isStillAdmitted()).toBe(true);
    now += SESSION_LIFETIME_SECONDS * 1000;
    expect(expiring.isStillAdmitted()).toBe(false);
  } finally {
    network.destroy();
  }
});
