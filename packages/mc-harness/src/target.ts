import { BridgeClient } from "#bridge/client.ts";
import type { SandboxBackend } from "#sandbox/provider.ts";
import type { SandboxRecord } from "#sandbox/record.ts";

/**
 * A Minecraft server the harness can act on. Every world operation goes
 * through the bridge; logs come from the backend that runs the server.
 */
export type Target = {
  readonly id: string;
  /** Sandbox provider, or `live` for minecraft-tsmc (src/live/service.ts). */
  readonly kind: SandboxRecord["provider"] | "live";
  readonly bridge: BridgeClient;
  readonly logs: { tail: (lines: number) => Promise<string[]> };
};

export function sandboxTarget(
  record: SandboxRecord,
  provider: SandboxBackend,
): Target {
  const { host, port } = record.endpoints.bridge;
  return {
    id: record.id,
    kind: record.provider,
    bridge: new BridgeClient({
      baseUrl: `http://${host}:${port.toString()}`,
      token: record.secrets.bridgeToken,
    }),
    logs: { tail: async (lines) => provider.logs(record, lines) },
  };
}
