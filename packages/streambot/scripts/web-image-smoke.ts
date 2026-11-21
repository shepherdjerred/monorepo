import path from "node:path";
import { serveWebAsset } from "@shepherdjerred/streambot/web/server/assets.ts";

const root = path.resolve(import.meta.dirname, "..");
for (const fixture of ["e2e/web-local.ts", "test/web/web-fixture.ts"]) {
  if (await Bun.file(path.join(root, fixture)).exists())
    throw new Error(
      "Local acceptance fixtures must not enter the production image",
    );
}
const assets = path.join(root, "dist/web");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => serveWebAsset(new URL(request.url), assets),
});
try {
  // The current remote at `/` and the classic remote at `/classic` each load their own bundle.
  for (const page of ["/", "/classic"]) {
    const response = await fetch(new URL(page, server.url));
    if (response.status !== 200)
      throw new Error("Web HTML for " + page + " must return HTTP 200");
    const html = await response.text();
    const scriptPath = /src="([^"]+)"/u.exec(html)?.[1];
    if (scriptPath === undefined)
      throw new Error(page + " must reference its JavaScript bundle");
    const script = await fetch(new URL(scriptPath, server.url));
    const scriptBody = await script.text();
    if (script.status !== 200 || scriptBody.length < 100)
      throw new Error(
        "Web JavaScript for " +
          page +
          " must return HTTP 200 and contain its bundle",
      );
  }
  console.log(
    "Web image smoke passed: both remotes return HTML and JavaScript with HTTP 200; local fixtures excluded.",
  );
} finally {
  await server.stop(true);
}
