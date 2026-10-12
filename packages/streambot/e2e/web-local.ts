import path from "node:path";
import { webFixture } from "#web-fixture";

// Local acceptance fixture: real web routes and playback actor, simulated Discord/media I/O.
// Never imported by the production entrypoint or included in its runtime image.
const origin = "http://127.0.0.1:8080";
const fixture = webFixture(
  origin,
  path.resolve(import.meta.dirname, "../dist/web"),
  true,
);
fixture.enableNumbered();
await fixture.seed();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 8080,
  fetch: async (request) => {
    const response = await fixture.handler(request);
    if (new URL(request.url).pathname === "/api/auth/discord/start") {
      const target = new URL(response.headers.get("location") ?? "");
      response.headers.set(
        "location",
        origin +
          "/api/auth/discord/callback?code=fixture&state=" +
          (target.searchParams.get("state") ?? ""),
      );
    }
    return response;
  },
});
console.log("Streambot local fixture: " + origin);
process.once("SIGINT", () => {
  void server.stop(true);
  fixture.close();
});
process.once("SIGTERM", () => {
  void server.stop(true);
  fixture.close();
});
