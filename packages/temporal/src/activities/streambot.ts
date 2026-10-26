import { Context } from "@temporalio/activity";
import { z } from "zod";

export async function reconcileStreambotPlayback(): Promise<void> {
  const bootstrap = z
    .object({
      STREAMBOT_INTERNAL_URL: z.url(),
      STREAMBOT_SCHEDULER_TOKEN: z.string().min(32),
    })
    .parse(Bun.env);
  const response = await fetch(
    new URL("/internal/sports/reconcile", bootstrap.STREAMBOT_INTERNAL_URL),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${bootstrap.STREAMBOT_SCHEDULER_TOKEN}`,
      },
      signal: AbortSignal.any([
        Context.current().cancellationSignal,
        AbortSignal.timeout(55_000),
      ]),
    },
  );
  if (!response.ok)
    throw new Error(
      `Streambot reconciliation failed: HTTP ${String(response.status)}`,
    );
  z.object({ reconciled: z.literal(true) }).parse(await response.json());
}
