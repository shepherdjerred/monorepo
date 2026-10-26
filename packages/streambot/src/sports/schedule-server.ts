import { timingSafeEqual } from "node:crypto";
import type { LolPlaybackSchedules } from "./playback-schedules.ts";

export function scheduleHandler(
  token: string,
  schedules: Pick<LolPlaybackSchedules, "reconcile">,
) {
  return async (request: Request) => {
    const expected = Buffer.from(`Bearer ${token}`);
    const provided = Buffer.from(request.headers.get("authorization") ?? "");
    if (
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    )
      return new Response("Unauthorized", { status: 401 });
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/internal/sports/reconcile"
    )
      return new Response("Not found", { status: 404 });
    try {
      await schedules.reconcile(
        AbortSignal.any([request.signal, AbortSignal.timeout(50_000)]),
      );
      return Response.json({ reconciled: true });
    } catch {
      return Response.json({ reconciled: false }, { status: 503 });
    }
  };
}
export function startScheduleServer(
  bootstrap: { token: string; port: number },
  schedules: LolPlaybackSchedules,
) {
  return Bun.serve({
    hostname: "0.0.0.0",
    port: bootstrap.port,
    idleTimeout: 60,
    fetch: scheduleHandler(bootstrap.token, schedules),
  });
}
