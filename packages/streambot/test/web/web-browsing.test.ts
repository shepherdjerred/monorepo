import { afterEach, expect, test } from "vitest";
import { webFixture } from "./web-fixture.ts";

let fixture: ReturnType<typeof webFixture> | undefined;
afterEach(() => {
  fixture?.close();
  fixture = undefined;
});

test("OAuth returns to any page the remote serves and rejects external, escaped, retired and unknown paths", async () => {
  fixture = webFixture();
  for (const returnTo of [
    "/history?visibility=server&q=Arrival&channel=2",
    "/music?q=Daft+Punk&album=aa997ea0-2936-40bd-884d-3af8a0e064dc",
    "/playlists?playlist=public-playlist&guild=100000000000000010",
    "/library?series=Severance",
    "/playlists/0b6f4b1e-0000-4000-8000-000000000000",
    "/playlists/0b6f4b1e-0000-4000-8000-000000000000?guild=100000000000000010",
    "/playlists?guild=100000000000000010&playlist=0b6f4b1e-0000-4000-8000-000000000000",
    "/album/MPREb_K8qWMWVqXGi",
    "/classic/plex",
    "https://evil.example/playlists?guild=100000000000000010",
    "/unknown?guild=100000000000000010&playlist=0b6f4b1e-0000-4000-8000-000000000000",
    "//evil.example/",
    String.raw`/\evil.example`,
    "/unknown",
    "/sports\n",
  ]) {
    const start = await fixture.handler(
      new Request(
        "http://127.0.0.1:8080/api/auth/discord/start?" +
          new URLSearchParams({ returnTo }).toString(),
      ),
    );
    const state = new URL(start.headers.get("location") ?? "").searchParams.get(
      "state",
    );
    const cookie = start.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const callback = await fixture.handler(
      new Request(
        "http://127.0.0.1:8080/api/auth/discord/callback?" +
          new URLSearchParams({
            code: "fixture",
            state: String(state),
          }).toString(),
        { headers: { cookie } },
      ),
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(
      [
        "/history?",
        "/music?",
        "/playlists?",
        "/library?",
        "/playlists/",
        "/album/",
      ].some((prefix) => returnTo.startsWith(prefix))
        ? returnTo
        : "/",
    );
  }
});
