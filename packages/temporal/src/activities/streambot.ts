import { setTimeout as delay } from "node:timers/promises";
import { Context } from "@temporalio/activity";
import { z } from "zod";
import { postStreambotReconcile } from "./streambot-reconcile-request.ts";

export async function reconcileStreambotPlayback(): Promise<void> {
  const bootstrap = z
    .object({
      STREAMBOT_INTERNAL_URL: z.url(),
      STREAMBOT_SCHEDULER_TOKEN: z.string().min(32),
    })
    .parse(Bun.env);
  // One deadline covers every connection attempt and retry delay, keeping the
  // whole reconcile inside the Activity's one-minute start-to-close timeout.
  const response = await postStreambotReconcile({
    url: new URL(
      "/internal/sports/reconcile",
      bootstrap.STREAMBOT_INTERNAL_URL,
    ),
    token: bootstrap.STREAMBOT_SCHEDULER_TOKEN,
    signal: AbortSignal.any([
      Context.current().cancellationSignal,
      AbortSignal.timeout(55_000),
    ]),
    fetch: (url, init) => fetch(url, init),
    sleep: (milliseconds, signal) => delay(milliseconds, undefined, { signal }),
  });
  if (!response.ok)
    throw new Error(
      `Streambot reconciliation failed: HTTP ${String(response.status)}`,
    );
  z.object({ reconciled: z.literal(true) }).parse(await response.json());
}
