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
