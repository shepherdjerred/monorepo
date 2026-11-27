import { Context } from "@temporalio/activity";

export async function refreshBrimArchive(): Promise<void> {
  const token = Bun.env["BRIM_SCHEDULER_TOKEN"];
  const origin = Bun.env["BRIM_API_URL"];
  if (
    token === undefined ||
    origin === undefined ||
    token.length === 0 ||
    origin.length === 0
  )
    throw new Error(
      "Brim archive refresh credentials and service URL are required",
    );
  const context = Context.current();
  const response = await fetch(new URL("/internal/v1/sync", origin), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    redirect: "error",
    signal: context.cancellationSignal,
  });
  await response.body?.cancel();
  if (!response.ok)
    throw new Error(`Brim archive refresh returned ${String(response.status)}`);
}
