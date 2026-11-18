import { setTimeout as delay } from "node:timers/promises";
import { Context } from "@temporalio/activity";
import { z } from "zod";
import {
  postStreambotReconcile,
  settleOnAbort,
} from "./streambot-reconcile-request.ts";

export async function reconcileStreambotPlayback(): Promise<void> {
  const bootstrap = z
    .object({
      STREAMBOT_INTERNAL_URL: z.url(),
      STREAMBOT_SCHEDULER_TOKEN: z.string().min(32),
    })
    .parse(Bun.env);
  // One deadline covers every connection attempt, retry delay, and response
  // body read, keeping the whole reconcile inside the Activity's 75-second
  // start-to-close timeout.
  const signal = AbortSignal.any([
    Context.current().cancellationSignal,
    AbortSignal.timeout(55_000),
  ]);
  const response = await postStreambotReconcile({
    url: new URL(
      "/internal/sports/reconcile",
      bootstrap.STREAMBOT_INTERNAL_URL,
    ),
    token: bootstrap.STREAMBOT_SCHEDULER_TOKEN,
    signal,
    fetch: (url, init) => fetch(url, init),
    sleep: (milliseconds, requestSignal) =>
      delay(milliseconds, undefined, { signal: requestSignal }),
  });
  if (!response.ok)
    throw new Error(
      `Streambot reconciliation failed: HTTP ${String(response.status)}`,
    );
  const body = await settleOnAbort(response.json(), signal);
  z.object({ reconciled: z.literal(true) }).parse(body);
}
