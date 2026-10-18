import { expect, test } from "vitest";
import { PlexPinAuthentication } from "./plex-auth.ts";
import { PlexHomeClient } from "#integrations/plex-home.ts";

function fixture() {
  const state = {
    machineId: "configured-server",
    sections: [{ key: "1", title: "Movies", type: "movie" }],
    resource: true,
  };
  const calls: { url: URL; headers: Headers }[] = [];
  const auth = new PlexPinAuthentication(
    {
      serverMachineId: "configured-server",
      serverUrl: "http://plex.fixture",
      permittedMovieSectionId: "1",
      permittedTvSectionId: "2",
      applicationName: "Media",
      returnUrl: "http://media.fixture",
    },
    async (input, init) => {
      const url = new URL(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      if (url.pathname === "/api/v2/resources")
        return Response.json(
          state.resource
            ? [
                {
                  clientIdentifier: state.machineId,
                  provides: "server",
                  accessToken: "scoped-fixture-token",
                },
              ]
            : [],
        );
      if (url.pathname === "/api/v2/user")
        return Response.json({ id: 42, restricted: false });
      if (url.pathname === "/identity")
        return Response.json({
          MediaContainer: { machineIdentifier: state.machineId },
        });
      if (url.pathname === "/library/sections")
        return Response.json({
          MediaContainer: {
            size: state.sections.length,
            Directory: state.sections,
          },
        });
      throw new Error("Unexpected fixture endpoint");
    },
  );
  return { state, calls, auth };
}

test("authorizes exact scoped permitted libraries and never forwards account token to PMS", async () => {
  const { auth, calls } = fixture();
  await expect(
    auth.resolveServerAccess("account-fixture-token"),
  ).resolves.toMatchObject({
    accountId: "42",
    permittedSectionIds: ["1"],
    permittedMediaKinds: ["movie"],
    plexRestricted: false,
  });
  expect(
    calls
      .filter((call) => call.url.hostname === "plex.fixture")
      .every(
        (call) => call.headers.get("X-Plex-Token") === "scoped-fixture-token",
      ),
  ).toBe(true);
});
test("server membership alone cannot authorize unrelated or wrong-type libraries", async () => {
  const { auth, state } = fixture();
  state.sections = [{ key: "99", title: "Movies", type: "movie" }];
  await expect(auth.resolveServerAccess("fixture")).resolves.toBeNull();
  state.sections = [{ key: "1", title: "Music", type: "artist" }];
  await expect(auth.resolveServerAccess("fixture")).resolves.toBeNull();
  state.resource = false;
  await expect(auth.resolveServerAccess("fixture")).resolves.toBeNull();
});
test("Home users with duplicate names remain distinct and switching validates returned ID", async () => {
  let wrong = false;
  const client = new PlexHomeClient(
    "fixture-owner-token",
    async (url, init) => {
      expect(new Headers(init.headers).get("X-Plex-Token")).toBe(
        "fixture-owner-token",
      );
      if (url.pathname === "/api/home/users")
        return new Response(
          '<MediaContainer size="2"><User id="10" title="Alex" restricted="1" protected="0"/><User id="20" title="Alex" restricted="1" protected="1"/></MediaContainer>',
        );
      expect(url.pathname).toBe("/api/home/users/20/switch");
      expect(url.searchParams.get("pin")).toBe("1234");
      return new Response(
        `<user id="${wrong ? "10" : "20"}" authenticationToken="fixture-managed-token"/>`,
      );
    },
  );
  const users = await client.users();
  expect(users.map((user) => user.id)).toEqual(["10", "20"]);
  await expect(client.switchUser("20", "1234")).resolves.toBe(
    "fixture-managed-token",
  );
  wrong = true;
  await expect(client.switchUser("20", "1234")).rejects.toMatchObject({
    kind: "invalid-response",
  });
});
test("Home token issuance with a lost response is an unknown effect with no URL or PIN in the error", async () => {
  const client = new PlexHomeClient("fixture-owner-token", async () => {
    throw new Error("sensitive transport detail");
  });
  await expect(client.switchUser("20", "1234")).rejects.toMatchObject({
    kind: "outcome-unknown",
    message: "plex-home: outcome-unknown",
  });
});
