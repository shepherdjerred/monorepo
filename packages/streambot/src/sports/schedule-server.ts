import { timingSafeEqual } from "node:crypto";
import type { LolPlaybackSchedules } from "./playback-schedules.ts";

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Streambot reconciliation deadline exceeded");
}

async function settleOnAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw abortError(signal);
  let removeAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => {
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbort = () => {
      signal.removeEventListener("abort", onAbort);
    };
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    removeAbort?.();
  }
}

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
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(50_000),
    ]);
    try {
      // Reconcile must observe the deadline even when an in-flight lookup does not.
      await settleOnAbort(schedules.reconcile(signal), signal);
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
