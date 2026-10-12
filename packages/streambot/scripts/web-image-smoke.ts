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
  const page = await fetch(server.url);
  if (page.status !== 200) throw new Error("Web HTML must return HTTP 200");
  const html = await page.text();
  const scriptPath = /src="([^"]+)"/u.exec(html)?.[1];
  if (scriptPath === undefined)
    throw new Error("Web entrypoint must reference its JavaScript bundle");
  const script = await fetch(new URL(scriptPath, server.url));
  const scriptBody = await script.text();
  if (script.status !== 200 || scriptBody.length < 100)
    throw new Error(
      "Web JavaScript must return HTTP 200 and contain its bundle",
    );
  console.log(
    "Web image smoke passed: HTML and JavaScript return HTTP 200; local fixtures excluded.",
  );
} finally {
  await server.stop(true);
}
