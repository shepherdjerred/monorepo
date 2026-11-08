import { BRIDGE_PORT, GAME_PORT, RCON_PORT } from "#sandbox/profiles.ts";
import type { SandboxRecord } from "#sandbox/record.ts";

export const LABELS = {
  sandbox: "mc-harness.sandbox",
  profile: "mc-harness.profile",
  expiresAt: "mc-harness.expires-at",
  owner: "mc-harness.owner",
  keep: "mc-harness.keep",
} as const;

export type SandboxRow = {
  containerId: string;
  id: string;
  expiresAt: string;
  keep: boolean;
  running: boolean;
  /** Exited or dead: unusable. A just-created container is not stale. */
  stale: boolean;
  ports: string;
};

/** Parses `docker ps -a` rows formatted by `SANDBOX_ROW_FORMAT`. */
export function parseSandboxRows(stdout: string): SandboxRow[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [
        containerId = "",
        id = "",
        expiresAt = "",
        keep = "",
        state = "",
        ports = "",
      ] = line.split("\t");
      return {
        containerId,
        id,
        expiresAt,
        keep: keep === "true",
        running: state === "running",
        stale: state === "exited" || state === "dead",
        ports,
      };
    });
}

export const SANDBOX_ROW_FORMAT = `{{.ID}}\t{{.Label "${LABELS.sandbox}"}}\t{{.Label "${LABELS.expiresAt}"}}\t{{.Label "${LABELS.keep}"}}\t{{.State}}\t{{.Ports}}`;

/** Reconcile the ephemeral loopback ports of a retained plain-world container after restart. */
export function currentDockerEndpoints(
  bindings: string,
): SandboxRecord["endpoints"] {
  const published = new Map<string, number>();
  for (const match of bindings.matchAll(/127\.0\.0\.1:(\d+)->(\d+)\/tcp/gu)) {
    const [, host, target] = match;
    if (host === undefined || target === undefined)
      throw new Error("Invalid Docker port binding");
    published.set(target, Number(host));
  }
  const endpoint = (target: number) => {
    const port = published.get(target.toString());
    if (port === undefined || port < 1 || port > 65_535)
      throw new Error(
        `Running sandbox lacks its loopback port ${target.toString()}`,
      );
    return { host: "127.0.0.1", port };
  };
  return {
    game: endpoint(GAME_PORT),
    rcon: endpoint(RCON_PORT),
    bridge: endpoint(BRIDGE_PORT),
  };
}
