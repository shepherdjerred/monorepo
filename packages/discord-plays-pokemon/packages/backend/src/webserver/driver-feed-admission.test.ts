import { expect, test } from "vitest";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { voiceAdmission } from "./driver-feed-admission.ts";

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
      Promise.resolve(cookie === "pokemon_session=test" ? USER : undefined),
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
