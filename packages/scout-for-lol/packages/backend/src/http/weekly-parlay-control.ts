import { timingSafeEqual } from "node:crypto";
import { WeeklyParlayControlActionSchema } from "@scout-for-lol/data/model/weekly-parlay.ts";
import configuration from "#src/configuration.ts";
import {
  runWeeklyParlayControlAction,
  WEEKLY_PARLAY_CONTROL_PATH,
} from "#src/betting/weekly/weekly-parlay-control.ts";
import { MY_SERVER } from "#src/configuration/flags.ts";

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

export async function handleWeeklyParlayControl(
  request: Request,
  url: URL,
): Promise<Response | null> {
  const token = configuration.weeklyParlayControlToken;
  if (token === undefined || url.pathname !== WEEKLY_PARLAY_CONTROL_PATH) {
    return null;
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!authorized(request, token)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = WeeklyParlayControlActionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success) {
    return Response.json({ error: "invalid_action" }, { status: 400 });
  }
  const result = await runWeeklyParlayControlAction(body.data, {
    serverId: MY_SERVER,
    signal: request.signal,
  });
  return Response.json(result, { status: 200 });
}
