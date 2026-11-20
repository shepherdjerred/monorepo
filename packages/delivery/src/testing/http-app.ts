import type { Delivery } from "#infrastructure/delivery.ts";
import type { RuntimeConfig } from "#infrastructure/config.ts";
import { createApp } from "#server/app.ts";
import type { Drain } from "#server/drain.ts";
import { testOperator } from "./seed.ts";

/** Actual auth/middleware stack with an isolated loopback test ingress. */
export function createTestApp(
  delivery: Delivery,
  config: Pick<
    RuntimeConfig,
    "machineCredentials" | "writesEnabled" | "enabledEnvironments"
  >,
  sourceRevision?: string,
  drain?: Drain,
) {
  return createApp({
    ...(sourceRevision === undefined ? {} : { sourceRevision }),
    ...(drain === undefined ? {} : { drain }),
    delivery,
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    qualifyBuild: () => Promise.resolve("verified"),
    peerAddress: () => "127.0.0.1",
    config: {
      ...config,
      publicOrigin: "http://delivery.test",
      operatorLogins: () => Promise.resolve([testOperator.id]),
      trustedProxyAddresses: () => Promise.resolve(["127.0.0.1"]),
    },
  });
}

/**
 * Read the change feed from its `ready` event, run `act`, and keep reading
 * until `until` holds or the stream ends. Returns everything read.
 */
export async function readChangeFeed(
  response: Response,
  act: () => Promise<unknown>,
  until: (text: string) => boolean,
) {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream"))
    throw new Error(`Change feed answered ${type}`);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("SSE body missing");
  const decoder = new TextDecoder();
  const ready = await reader.read();
  let text = decoder.decode(ready.value);
  if (!text.includes("event: ready"))
    throw new Error(`Change feed did not open with ready: ${text}`);
  await act();
  while (!until(text)) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value);
  }
  await reader.cancel();
  return text;
}
