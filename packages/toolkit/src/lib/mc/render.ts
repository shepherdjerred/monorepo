import type {
  BridgeEvent,
  CommandResponse,
  InfoResponse,
  Player,
  RegionReadResponse,
  Snapshot,
  WeRunResponse,
} from "@shepherdjerred/mc-harness/protocol/bridge.ts";
import type {
  SandboxSummary,
  StatusResponse,
} from "@shepherdjerred/mc-harness/protocol/ipc.ts";

export function renderStatus(status: StatusResponse): string {
  return [
    `mc daemon pid ${String(status.pid)} (protocol ${String(status.protocolVersion)})`,
    `  started ${status.startedAt}, idle ${String(status.idleSeconds)}s of ${String(status.ttlSeconds)}s TTL`,
    `  repo ${status.repoRoot}`,
    `  sandboxes: ${String(status.sandboxes)}`,
  ].join("\n");
}

export function renderSandbox(sandbox: SandboxSummary): string {
  const { game, bridge } = sandbox.endpoints;
  return [
    `${sandbox.id}  ${sandbox.status}  ${sandbox.profile}/${sandbox.world}${sandbox.keep ? "  keep" : ""}`,
    `  game ${game.host}:${String(game.port)}  bridge ${bridge.host}:${String(bridge.port)}`,
    `  expires ${sandbox.expiresAt}  boot ${String(Math.round(sandbox.bootMs / 1000))}s`,
  ].join("\n");
}

export function renderSandboxes(sandboxes: readonly SandboxSummary[]): string {
  return sandboxes.length === 0
    ? "No sandboxes."
    : sandboxes.map((sandbox) => renderSandbox(sandbox)).join("\n");
}

export function renderCommand(result: CommandResponse): string {
  const status = result.success ? "ok" : "FAILED";
  return [`[${status}]`, ...result.output].join("\n");
}

export function renderWe(result: WeRunResponse): string {
  const lines = result.results.flatMap((op) => [
    `${op.ok ? "ok " : "ERR"} ${op.command}  (changed ${String(op.changed)})`,
    ...op.messages.map((message) => `    ${message}`),
    ...op.errors.map((message) => `  ! ${message}`),
  ]);
  return [...lines, `history: ${String(result.historySize)}`].join("\n");
}

/** Block counts per state, most common first. */
export function paletteCounts(region: RegionReadResponse): [string, number][] {
  const indices = new Uint32Array(
    Uint8Array.from(Buffer.from(region.blocks, "base64")).buffer,
  );
  const counts = new Map<number, number>();
  for (const index of indices) {
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([index, count]): [string, number] => [
      region.palette[index] ?? `#${String(index)}`,
      count,
    ])
    .toSorted((a, b) => b[1] - a[1]);
}

export function renderRegion(region: RegionReadResponse): string {
  const { size } = region;
  return [
    `${region.world} ${String(region.min.x)},${String(region.min.y)},${String(region.min.z)} → ${String(region.max.x)},${String(region.max.y)},${String(region.max.z)} (${String(size.x)}×${String(size.y)}×${String(size.z)})`,
    ...paletteCounts(region).map(
      ([state, count]) => `  ${String(count).padStart(8)}  ${state}`,
    ),
    `  block entities: ${String(region.blockEntities.length)}`,
  ].join("\n");
}

export function renderSnapshot(snapshot: Snapshot): string {
  const { box } = snapshot;
  return `${snapshot.id}  ${box.world} ${String(box.min.x)},${String(box.min.y)},${String(box.min.z)} → ${String(box.max.x)},${String(box.max.y)},${String(box.max.z)}  ${String(snapshot.bytes)} B  ${snapshot.createdAt}${snapshot.label === undefined ? "" : `  ${snapshot.label}`}`;
}

export function renderInfo(info: InfoResponse): string {
  return [
    `Minecraft ${info.minecraftVersion} (data ${String(info.dataVersion)}) — ${info.serverVersion}`,
    `bridge ${info.bridgeVersion} (api ${String(info.apiVersion)}), online mode ${String(info.onlineMode)}`,
    `capabilities: ${info.capabilities.join(", ") || "none"}`,
    "worlds:",
    ...info.worlds.map(
      (world) =>
        `  ${world.name} (${world.key}, ${world.environment}, y ${String(world.minY)}..${String(world.maxY)})`,
    ),
    "plugins:",
    ...info.plugins.map(
      (plugin) =>
        `  ${plugin.name} ${plugin.version}${plugin.enabled ? "" : " (disabled)"}`,
    ),
  ].join("\n");
}

export function renderPlayers(players: readonly Player[]): string {
  return players.length === 0
    ? "No players online."
    : players
        .map(
          (player) =>
            `${player.name}${player.npc ? " [npc]" : ""}  ${player.world} ${player.pos.x.toFixed(1)},${player.pos.y.toFixed(1)},${player.pos.z.toFixed(1)}  ${player.gameMode}`,
        )
        .join("\n");
}

export function renderEvents(events: readonly BridgeEvent[]): string {
  return events
    .map(
      (event) =>
        `${String(event.seq).padStart(6)} ${event.ts} ${event.type}${event.player === undefined ? "" : ` <${event.player}>`} ${event.text}`,
    )
    .join("\n");
}
