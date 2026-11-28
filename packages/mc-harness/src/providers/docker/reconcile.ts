import { GAME_PORT } from "#sandbox/profiles.ts";
import {
  dockerContainerId,
  type SandboxRecord,
  type SandboxStore,
} from "#sandbox/record.ts";
import { publishedPort } from "./paper-container.ts";
import { startCaptureProxy, type CaptureProxy } from "./proxy.ts";
import { currentDockerEndpoints } from "./rows.ts";

function sameEndpoint(
  left: { host: string; port: number },
  right: { host: string; port: number },
): boolean {
  return left.host === right.host && left.port === right.port;
}

function sameEndpoints(
  left: SandboxRecord["endpoints"],
  right: SandboxRecord["endpoints"],
): boolean {
  return (
    sameEndpoint(left.game, right.game) &&
    sameEndpoint(left.rcon, right.rcon) &&
    sameEndpoint(left.bridge, right.bridge)
  );
}

/**
 * Reconciles a running Docker sandbox's published host ports (and real-map
 * capture proxy when the backing game port changed across `docker restart`),
 * persisting updated endpoints to `record.json`.
 */
export async function reconcileRunningSandbox(options: {
  record: SandboxRecord;
  ports: string;
  store: SandboxStore;
  proxies: Map<string, CaptureProxy>;
}): Promise<SandboxRecord> {
  const { record, ports, store, proxies } = options;
  if (record.world !== "real-map") {
    const next: SandboxRecord = {
      ...record,
      status: "ready",
      endpoints: currentDockerEndpoints(ports),
    };
    if (
      record.status !== "ready" ||
      !sameEndpoints(record.endpoints, next.endpoints)
    ) {
      await store.write(next);
    }
    return next;
  }

  const existing = proxies.get(record.id);
  if (existing !== undefined && ports.length === 0) {
    return {
      ...record,
      status: "ready",
      endpoints: { ...record.endpoints, game: existing.endpoint },
    };
  }
  const dockerEndpoints =
    ports.length > 0
      ? currentDockerEndpoints(ports)
      : {
          ...record.endpoints,
          game: await publishedPort(dockerContainerId(record), GAME_PORT),
        };
  if (
    existing !== undefined &&
    sameEndpoint(existing.backend, dockerEndpoints.game)
  ) {
    const next: SandboxRecord = {
      ...record,
      status: "ready",
      endpoints: {
        game: existing.endpoint,
        rcon: dockerEndpoints.rcon,
        bridge: dockerEndpoints.bridge,
      },
    };
    if (
      record.status !== "ready" ||
      !sameEndpoints(record.endpoints, next.endpoints)
    ) {
      await store.write(next);
    }
    return next;
  }

  const proxy = await startCaptureProxy(dockerEndpoints.game);
  const next: SandboxRecord = {
    ...record,
    status: "ready",
    endpoints: {
      game: proxy.endpoint,
      rcon: dockerEndpoints.rcon,
      bridge: dockerEndpoints.bridge,
    },
  };
  try {
    await store.write(next);
    existing?.close();
    proxies.set(record.id, proxy);
    return next;
  } catch (error) {
    proxy.close();
    throw error;
  }
}
