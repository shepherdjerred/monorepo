// Pure helpers for `toolkit mc client …` (the real rendered Minecraft client).
import path from "node:path";
import {
  CLIENT_BUTTONS,
  ClientButtonSchema,
  type ClientState,
  type ClientStatusResponse,
  type ClientSummary,
} from "@shepherdjerred/mc-harness/protocol/client.ts";

function finite(raw: string | undefined, name: string): number {
  const value = Number(raw);
  if (raw === undefined || raw.length === 0 || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a number`);
  }
  return value;
}

/** `look <yaw> <pitch>`: degrees; yaw 0 faces south, 90 west, 180 north, 270 east. */
export function lookBody(positionals: string[]): {
  yaw: number;
  pitch: number;
} {
  const [yaw, pitch] = positionals;
  return { yaw: finite(yaw, "<yaw>"), pitch: finite(pitch, "<pitch>") };
}

/** `hotbar <0-8>`. */
export function hotbarBody(positionals: string[]): { slot: number } {
  const slot = finite(positionals[0], "<slot>");
  if (!Number.isInteger(slot) || slot < 0 || slot > 8) {
    throw new Error("<slot> is a hotbar index 0-8");
  }
  return { slot };
}

/** `move <button…> [--ticks 20]`. */
export function moveBody(
  positionals: string[],
  ticks: string | undefined,
): { buttons: string[]; ticks: number } {
  if (positionals.length === 0) {
    throw new Error(`move needs buttons: ${CLIENT_BUTTONS.join(", ")}`);
  }
  for (const button of positionals) {
    if (!ClientButtonSchema.safeParse(button).success) {
      throw new Error(
        `unknown button "${button}"; use ${CLIENT_BUTTONS.join(", ")}`,
      );
    }
  }
  return {
    buttons: positionals,
    ticks: ticks === undefined ? 20 : finite(ticks, "--ticks"),
  };
}

/** Absolute path for `capture --out`, relative to the caller's directory. */
export function captureOut(
  out: string | undefined,
  cwd: string,
): string | undefined {
  if (out === undefined) {
    return undefined;
  }
  const resolved = path.resolve(cwd, out);
  if (!resolved.endsWith(".png")) {
    throw new Error("--out must end in .png");
  }
  return resolved;
}

function round(value: number): string {
  return value.toFixed(1);
}

function renderState(state: ClientState): string[] {
  if (!state.connected) {
    return [
      `  not in a world${state.screen === "" ? "" : ` (screen "${state.screen}")`}`,
    ];
  }
  const [x, y, z] = state.position;
  const held = state.inventory.find((item) => item.slot === state.hotbar);
  const heldText =
    held === undefined || held.type === "minecraft:air"
      ? "empty hand"
      : `${held.type} ×${held.count.toString()}`;
  const target = state.target;
  const targetText =
    target.kind === "miss"
      ? "nothing"
      : `${target.kind} ${String(target["type"])}${
          Array.isArray(target["position"])
            ? ` @ ${target["position"].join(",")}`
            : ""
        }`;
  return [
    `  at ${round(x)},${round(y)},${round(z)} in ${state.world}; yaw ${round(state.yaw)} pitch ${round(state.pitch)}`,
    `  health ${round(state.health)}, food ${state.food.toString()}; hotbar ${state.hotbar.toString()} (${heldText})`,
    `  looking at ${targetText}`,
    `  screen ${state.screen === "" ? "none" : `"${state.screen}"`}; held inputs ${
      state.heldInputs.length === 0 ? "none" : state.heldInputs.join(", ")
    }; ${round(state.fps)} fps`,
  ];
}

export function renderClientSummary(client: ClientSummary): string {
  return `${client.name} → ${client.target} (${client.server}), started ${client.startedAt}, launcher pid ${client.pid.toString()}`;
}

export function renderClientStatus(status: ClientStatusResponse): string {
  return [
    renderClientSummary(status.client),
    ...renderState(status.state),
    `  artifacts ${status.client.artifacts}`,
  ].join("\n");
}

export function renderClients(clients: ClientSummary[]): string {
  return clients.length === 0
    ? "No clients running. Start one with: toolkit mc client start"
    : clients.map((client) => renderClientSummary(client)).join("\n");
}
