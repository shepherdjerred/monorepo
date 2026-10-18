import {
  createApp,
  testExecutor,
  testOperator,
} from "@shepherdjerred/delivery/testing";
import { createDeliveryClient } from "@shepherdjerred/delivery/client";

/** Real HTTP/auth boundary shared by isolated PostgreSQL executor tests. */
export function executionApiFixture(
  delivery: Parameters<typeof createApp>[0]["delivery"],
  environments: string[],
  writesEnabled: () => Promise<boolean> = () => Promise.resolve(true),
) {
  const app = createApp({
    delivery,
    peerAddress: () => "127.0.0.1",
    ciOrigin: "https://woodpecker.sjer.red",
    ciRepositoryId: 1,
    qualifyBuild: () => Promise.resolve("verified" as const),
    config: {
      publicOrigin: "http://localhost",
      machineCredentials: [
        { token: "platform-test-operator", principal: testOperator },
        { token: "platform-test-executor", principal: testExecutor },
      ],
      writesEnabled,
      enabledEnvironments: () => Promise.resolve(environments),
      operatorLogins: () => Promise.resolve([]),
      trustedProxyAddresses: () => Promise.resolve([]),
    },
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: app.fetch,
  });
  return {
    server,
    operator: createDeliveryClient({
      baseUrl: server.url.origin,
      headers: { authorization: "Bearer platform-test-operator" },
    }),
  };
}
