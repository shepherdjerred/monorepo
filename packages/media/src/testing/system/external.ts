import type { PlexAuthentication } from "#application/auth.ts";
import type { PlexPermissionSnapshot } from "#application/plex-access.ts";
import { TmdbClient } from "#integrations/tmdb.ts";

export const SYSTEM_MOVIE = {
  id: 987_654,
  title: "Synthetic System Movie",
  original_title: "Synthetic System Movie",
  overview: "Generated media used only in the isolated system harness.",
  release_date: "2020-01-01",
  poster_path: null,
  original_language: "en",
  imdb_id: "tt987654321",
  runtime: 1,
};

/** External identity/catalog fixtures; application authentication and commands stay real. */
export function systemExternalServices(
  additional?: (request: Request) => Response | Promise<Response>,
) {
  let selectedAccount = "1001";
  let permissions: Pick<
    PlexPermissionSnapshot,
    "permittedSectionIds" | "permittedMediaKinds" | "plexRestricted"
  > = {
    permittedSectionIds: ["1", "2"],
    permittedMediaKinds: ["movie", "series"],
    plexRestricted: false,
  };
  const identities = new Map<string, string>();
  const pins = new Map<number, string>();
  const serverMachineId = "isolated-system-server";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/authorize")
        return new Response("Synthetic Plex authorization");
      if (url.pathname === "/api/home/users")
        return new Response(
          '<MediaContainer size="2"><User id="1001" title="System Owner" restricted="0" protected="0"/><User id="1002" title="System Member" restricted="0" protected="0"/></MediaContainer>',
          { headers: { "Content-Type": "application/xml" } },
        );
      if (url.pathname === "/accounts")
        return Response.json({
          MediaContainer: {
            size: 2,
            Account: [
              { id: 1001, name: "System Owner", key: "/accounts/1001" },
              { id: 1002, name: "System Member", key: "/accounts/1002" },
            ],
          },
        });
      if (url.pathname === `/3/movie/${String(SYSTEM_MOVIE.id)}`)
        return Response.json(SYSTEM_MOVIE);
      if (
        url.pathname ===
        `/3/movie/${String(SYSTEM_MOVIE.id)}/alternative_titles`
      )
        return Response.json({ id: SYSTEM_MOVIE.id, titles: [] });
      if (url.pathname === "/3/search/multi")
        return Response.json({
          page: 1,
          total_pages: 1,
          results: [{ ...SYSTEM_MOVIE, media_type: "movie" }],
        });
      if (additional !== undefined) return additional(request);
      return new Response("Unimplemented external fixture route", {
        status: 404,
      });
    },
  });
  const access = (token: string) => {
    const accountId = identities.get(token);
    return accountId === undefined
      ? null
      : {
          accountId,
          serverMachineId,
          serverToken: `synthetic-server-${accountId}`,
          ...permissions,
        };
  };
  const plex: PlexAuthentication = {
    createPin: () => {
      const id = pins.size + 1;
      pins.set(id, selectedAccount);
      return Promise.resolve({
        id,
        code: `system-${String(id)}`,
        expiresAt: new Date(Date.now() + 300_000),
        authorizationUrl: new URL("/authorize", server.url).toString(),
        deviceState: String(id),
      });
    },
    resolvePin: (id) => {
      const accountId = pins.get(id);
      if (accountId === undefined)
        throw new Error("Unknown synthetic Plex PIN");
      const token = `synthetic-token-${accountId}`;
      identities.set(token, accountId);
      return Promise.resolve({
        accountId,
        displayName: accountId === "1001" ? "System Owner" : "System Member",
        token,
      });
    },
    resolveServerAccess: (token) => Promise.resolve(access(token)),
    resolveServerToken: (token) =>
      Promise.resolve(access(token)?.serverToken ?? null),
    refresh: (deviceState) => {
      const accountId = pins.get(Number(deviceState));
      if (accountId === undefined)
        throw new Error("Unknown synthetic Plex device");
      return Promise.resolve(`synthetic-token-${accountId}`);
    },
  };
  const transport = (url: URL, init?: RequestInit) =>
    fetch(new URL(url.pathname + url.search, server.url), init);
  return {
    plex,
    transport,
    tmdb: new TmdbClient(
      { kind: "api-key", apiKey: "synthetic-only" },
      transport,
    ),
    plexUrl: server.url.origin,
    serverMachineId,
    ownerAccountId: "1001",
    selectAccount: (accountId: "1001" | "1002") => {
      selectedAccount = accountId;
    },
    setPermissions: (next: typeof permissions) => {
      permissions = next;
    },
    close: () => server.stop(true),
  };
}
