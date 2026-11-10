import { generateKeyPairSync } from "node:crypto";
import { createMovieWorkflowFixture } from "./fixture.ts";
import { PlexPinAuthentication } from "#infrastructure/plex-auth.ts";
import { requesterAccessRefresher } from "#infrastructure/requester-access/refresh.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";

type AccessMode =
  "allowed" | "revoked" | "mismatch" | "restricted" | "expired" | "unavailable";

/** Real movie consent and registered-device resolver; only Plex's HTTP responses are synthetic. */
export async function movieRequesterAccessFixture(
  bytes: Uint8Array = new Uint8Array([1]),
) {
  const accountId = "81001";
  const f = await createMovieWorkflowFixture("default", {
    bytes,
    plexAccountId: accountId,
  });
  const { db, context, user } = f.source;
  const device = generateKeyPairSync("ed25519");
  const credential = {
    token: "movie-account-token",
    serverToken: "movie-server-token",
    deviceState: JSON.stringify({
      clientId: "movie-registered-device",
      keyId: "movie-key",
      privateKey: device.privateKey.export({ format: "pem", type: "pkcs8" }),
    }),
  };
  await db.credential.update({
    where: { userId_kind: { userId: user.id, kind: "plex" } },
    data: {
      ciphertext: context.cipher.encrypt(
        JSON.stringify(credential),
        `plex:${accountId}`,
      ),
    },
  });
  const state: { mode: AccessMode } = { mode: "allowed" };
  const calls: string[] = [];
  const auth = new PlexPinAuthentication(
    {
      serverMachineId: "fixture-server",
      serverUrl: "http://plex.fixture",
      permittedMovieSectionId: "1",
      permittedTvSectionId: "2",
      applicationName: "Media",
      returnUrl: "http://media.fixture",
    },
    (input, init) => {
      const pathname = new URL(input).pathname;
      calls.push(pathname);
      if (state.mode === "unavailable")
        return Promise.resolve(new Response(null, { status: 503 }));
      const token = new Headers(init?.headers).get("X-Plex-Token");
      if (state.mode === "expired" && token === credential.token)
        return Promise.resolve(new Response(null, { status: 401 }));
      switch (pathname) {
        case "/api/v2/auth/nonce":
          return Promise.resolve(Response.json({ nonce: "movie-nonce" }));
        case "/api/v2/auth/token":
          return Promise.resolve(
            Response.json({ auth_token: "movie-renewed-token" }),
          );
        case "/api/v2/user":
          return Promise.resolve(
            Response.json({
              id: state.mode === "mismatch" ? 81_002 : 81_001,
              restricted: state.mode === "restricted",
            }),
          );
        case "/api/v2/resources":
          return Promise.resolve(
            Response.json(
              state.mode === "revoked"
                ? []
                : [
                    {
                      clientIdentifier: "fixture-server",
                      provides: "server",
                      accessToken: credential.serverToken,
                    },
                  ],
            ),
          );
        case "/identity":
          return Promise.resolve(
            Response.json({
              MediaContainer: { machineIdentifier: "fixture-server" },
            }),
          );
        case "/library/sections":
          return Promise.resolve(
            Response.json({
              MediaContainer: {
                size: 2,
                Directory: [
                  { key: "1", title: "Movies", type: "movie" },
                  { key: "2", title: "TV", type: "show" },
                ],
              },
            }),
          );
        default:
          throw new Error("Unexpected movie requester Plex protocol");
      }
    },
  );
  const refresh = requesterAccessRefresher(
    db,
    context.cipher,
    () => Promise.resolve(auth),
    { serverUrl: "http://plex.fixture", serverMachineId: "fixture-server" },
  );
  const network = { ...context, refreshRequesterAccess: refresh };
  return {
    ...f,
    db,
    network,
    state,
    calls,
    credential,
    movie: createMovieNetworkFacetV4(network),
    expire: async () => {
      const verifiedAt = new Date(Date.now() - 301_000);
      await db.plexIdentityMapping.update({
        where: { userId: user.id },
        data: { verifiedAt },
      });
      return verifiedAt;
    },
  };
}
