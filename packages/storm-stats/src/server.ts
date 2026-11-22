import {
  startStormStatsServer,
  type StormStatsRunningServer,
} from "./server/index.ts";

/** Lightweight stateless probe handler for direct unit tests. */
export function handle(request: Request): Response {
  return new URL(request.url).pathname === "/healthz"
    ? new Response("ok")
    : new Response("not found", { status: 404 });
}

export async function startServer(
  port?: number,
  hostname?: string,
): Promise<StormStatsRunningServer> {
  return startStormStatsServer({
    ...(port === undefined ? {} : { port }),
    ...(hostname === undefined ? {} : { hostname }),
  });
}
