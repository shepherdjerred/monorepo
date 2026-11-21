/** Runs the Discord OAuth start and callback round trip against a fixture handler. */
export async function discordLogin(
  handler: (request: Request) => Promise<Response>,
  origin = "http://127.0.0.1:8080",
): Promise<Response> {
  const start = await handler(new Request(origin + "/api/auth/discord/start"));
  const state = new URL(start.headers.get("location") ?? "").searchParams.get(
    "state",
  );
  const cookie = start.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return await handler(
    new Request(
      origin + "/api/auth/discord/callback?code=fixture&state=" + String(state),
      { headers: { cookie } },
    ),
  );
}
