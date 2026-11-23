import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCombatTimelineWorker } from "./tools/build-combat-worker.ts";
const source = dirname(fileURLToPath(import.meta.url));
const combatWorker = await buildCombatTimelineWorker(source);
const observationsRoute =
  "/packages/scout-for-lol/packages/replay/src/observations/";
const observationsRoot = fileURLToPath(
  new URL(
    "../../../../packages/scout-for-lol/packages/replay/src/observations/",
    import.meta.url,
  ),
);
const sharedTransportRoute =
  "/packages/scout-for-lol/packages/domain/src/artifacts/replay-transport.mjs";
const sharedTransportModule = fileURLToPath(
  new URL(
    "../../../../packages/scout-for-lol/packages/domain/src/artifacts/replay-transport.mjs",
    import.meta.url,
  ),
);
const assets = resolve(process.argv[2] ?? ".cache/replay-spike/public");
const fixture = resolve(
  process.argv[3] ??
    `${process.env.TEMP}/scout-replay-spike/KR_8305643709.rofl`,
);
const latestFixture = process.argv[4] ? resolve(process.argv[4]) : null;
const portArgument = process.argv[5] ?? "4180";
if (!/^[1-9][0-9]*$/.test(portArgument) || Number(portArgument) > 65535)
  throw Error("Replay server port must be an integer between 1 and 65535");
if (process.argv.length > 6)
  throw Error(
    "Usage: bun serve.ts [assets] [fixture.rofl] [latest.rofl] [port]",
  );
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(portArgument),
  async fetch(request) {
    const url = new URL(request.url);
    let path;
    if (url.pathname === "/combat-timeline-worker.mjs")
      return new Response(combatWorker, {
        headers: {
          "Content-Type": "text/javascript",
          "Cache-Control": "no-cache",
        },
      });
    if (url.pathname.startsWith(observationsRoute)) {
      const name = url.pathname.slice(observationsRoute.length);
      if (!/^[a-z-]+\.mjs$/.test(name))
        return new Response("Forbidden", { status: 403 });
      path = resolve(observationsRoot, name);
    } else if (url.pathname === sharedTransportRoute)
      path = sharedTransportModule;
    else if (url.pathname === "/fixture.rofl") path = fixture;
    else if (url.pathname === "/research-latest.rofl") {
      if (!latestFixture)
        return new Response("Latest research replay not configured", {
          status: 404,
        });
      path = latestFixture;
    } else {
      const root = url.pathname.startsWith("/assets/") ? assets : source;
      const relative =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(
              url.pathname.replace(/^\/assets\//, "").replace(/^\//, ""),
            );
      path = resolve(root, relative);
      if (!path.startsWith(root + sep))
        return new Response("Forbidden", { status: 403 });
    }
    const file = Bun.file(path);
    if (!(await file.exists()))
      return new Response("Not found", { status: 404 });
    const headers = new Headers({
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (path.endsWith(".mjs")) headers.set("Content-Type", "text/javascript");
    return new Response(file, { headers });
  },
});
console.log(`Replay spike: ${server.url}`);
