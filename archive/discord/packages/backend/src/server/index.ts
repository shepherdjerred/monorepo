import configuration from "../configuration.ts";
import staticFiles from "https://deno.land/x/static_files@1.1.6/mod.ts";

const serveFiles = (req: Request) =>
  staticFiles(configuration.dataDir)({
    request: req,
    respondWith: (r: Response) => r,
  });

Deno.serve({ port: configuration.port }, (req) => {
  if (new URL(req.url).pathname === "/") {
    return new Response("Hello :)");
  }
  if (new URL(req.url).pathname === "/ping") {
    return new Response("pong");
  }
  return serveFiles(req);
});
