import { timingSafeEqual } from "node:crypto";
import configuration from "#src/configuration.ts";
import { runBryanBucksAnalyticsSync } from "#src/betting/analytics/bryan-bucks-analytics-control.ts";

/**
 * Internal control surface for the Bryan Bucks analytics reconciliation the
 * `scout-bryan-bucks-analytics` Temporal Schedule drives every fifteen minutes.
 *
 * The route is absent unless its private bootstrap token is configured, so a
 * deployment without the credential simply does not expose it.
 */
export const BRYAN_BUCKS_CONTROL_PATH =
  "/api/internal/bryan-bucks/analytics-sync";

function authorized(request: Request, expected: string): boolean {
  const header = request.headers.get("Authorization");
  if (header?.startsWith("Bearer ") !== true) return false;
  const presentedBytes = Buffer.from(header.slice("Bearer ".length));
  const expectedBytes = Buffer.from(expected);
  return (
    presentedBytes.length === expectedBytes.length &&
    timingSafeEqual(presentedBytes, expectedBytes)
  );
}

export async function handleBryanBucksControl(
  request: Request,
  url: URL,
): Promise<Response | null> {
  const token = configuration.bryanBucksControlToken;
  if (token === undefined || url.pathname !== BRYAN_BUCKS_CONTROL_PATH) {
    return null;
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  return authorized(request, token)
    ? Response.json(await runBryanBucksAnalyticsSync(), { status: 200 })
    : new Response("Unauthorized", { status: 401 });
}
