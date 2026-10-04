import { stat } from "node:fs/promises";
import path from "node:path";
import {
  type Actor,
  type ActorAction,
  type ActorActionResponse,
  ActorActionRequestSchemas,
  type ActorObservation,
  type BridgeEvent,
} from "@shepherdjerred/mc-harness/protocol/bridge.ts";
import { parseBlockPos } from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import type { PlaytestReport } from "@shepherdjerred/mc-harness/protocol/playtest.ts";

/** Flag values `toolkit mc actor act` accepts; each action reads the ones it needs. */
export type ActorActFlags = {
  pos?: string | undefined;
  range?: string | undefined;
  timeout?: string | undefined;
  item?: string | undefined;
  count?: string | undefined;
  slot?: string | undefined;
  block?: string | undefined;
  entity?: string | undefined;
  type?: string | undefined;
};

function numberFlag(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a number`);
  }
  return value;
}

function requirePos(flags: ActorActFlags): { x: number; y: number; z: number } {
  if (flags.pos === undefined) {
    throw new Error("--pos x,y,z is required for this action");
  }
  return parseBlockPos(flags.pos);
}

function requireText(text: string, what: string): string {
  if (text.length === 0) {
    throw new Error(`${what} is required`);
  }
  return text;
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

/** Builds and validates one action's body from CLI flags and trailing text. */
export function actorActionBody(
  action: ActorAction,
  flags: ActorActFlags,
  text: string,
): unknown {
  const bodies: Record<ActorAction, () => unknown> = {
    goto: () => ({
      pos: requirePos(flags),
      ...optional("range", numberFlag(flags.range, "--range")),
      ...optional("timeoutMs", numberFlag(flags.timeout, "--timeout")),
    }),
    look: () => ({ pos: requirePos(flags) }),
    equip: () => ({
      item: requireText(flags.item ?? "", "--item"),
      ...optional("count", numberFlag(flags.count, "--count")),
      ...optional("slot", flags.slot),
    }),
    command: () => ({ command: requireText(text, "a command") }),
    chat: () => ({ message: requireText(text, "a message") }),
    break: () => ({ pos: requirePos(flags) }),
    place: () => ({
      pos: requirePos(flags),
      block: requireText(flags.block ?? "", "--block"),
    }),
    use: () => ({ pos: requirePos(flags) }),
    attack: () =>
      flags.entity === undefined
        ? { type: requireText(flags.type ?? "", "--entity <uuid> or --type") }
        : { entity: flags.entity },
  };
  return ActorActionRequestSchemas[action].parse(bodies[action]());
}

function vec(pos: { x: number; y: number; z: number }): string {
  return `${String(pos.x)},${String(pos.y)},${String(pos.z)}`;
}

function eventLine(event: BridgeEvent): string {
  const who = event.player === undefined ? "" : ` ${event.player}`;
  return `  #${String(event.seq)} ${event.type}${who}: ${event.text}`;
}

export function renderActor(actor: Actor): string {
  return `${actor.name}  ${actor.gameMode}${actor.op ? " op" : ""}  ${actor.world} ${vec(actor.pos)}`;
}

export function renderActors(actors: readonly Actor[]): string {
  return actors.length === 0
    ? "No actors."
    : actors.map((actor) => renderActor(actor)).join("\n");
}

export function renderActorAction(result: ActorActionResponse): string {
  return [
    `${result.ok ? "ok" : "FAILED"}  ${result.detail}`,
    `  at ${vec(result.pos)}`,
    ...result.events.map((event) => eventLine(event)),
  ].join("\n");
}

export function renderObservation(observation: ActorObservation): string {
  const held =
    observation.heldItem === null
      ? "nothing"
      : `${String(observation.heldItem.count)} ${observation.heldItem.item}`;
  return [
    renderActor(observation.actor),
    `  health ${String(observation.health)}  food ${String(observation.food)}  holding ${held}`,
    `  looking at ${observation.lookingAt === null ? "nothing" : `${observation.lookingAt.state} @ ${vec(observation.lookingAt.pos)}`}`,
    `  inventory: ${observation.inventory.map((stack) => `${String(stack.count)} ${stack.item}`).join(", ") || "empty"}`,
    `  nearby: ${observation.nearby.map((entity) => `${entity.name ?? entity.type} (${String(entity.distance)}m)`).join(", ") || "none"}`,
    ...observation.events.map((event) => eventLine(event)),
  ].join("\n");
}

export function renderReport(report: PlaytestReport): string {
  const lines = [
    `${report.status.toUpperCase()}  ${report.scenario.name}  (${String(Math.round(report.durationMs / 100) / 10)}s, ${report.runId})`,
    ...(report.reason === undefined ? [] : [`  ${report.reason}`]),
    ...report.steps.map(
      (step) =>
        `  step ${step.status === "passed" ? "✓" : "✗"} ${step.name}${step.error === undefined ? "" : `: ${step.error}`}`,
    ),
    ...report.assertions
      .filter((assertion) => !assertion.passed)
      .map(
        (assertion) =>
          `  assert ✗ ${assertion.description}${assertion.detail === undefined ? "" : ` (${assertion.detail})`}`,
      ),
  ];
  if (report.failure !== undefined) {
    lines.push(`  failure: ${report.failure.message}`);
    lines.push(
      ...report.failure.eventTail.slice(-8).map((event) => eventLine(event)),
    );
  }
  lines.push(`  report ${path.join(report.dir, "report.json")}`);
  return lines.join("\n");
}

/** Expands files and directories into absolute `*.playtest.ts` paths. */
export async function playtestFiles(
  inputs: readonly string[],
): Promise<string[]> {
  const files: string[] = [];
  for (const input of inputs) {
    const absolute = path.resolve(input);
    const info = await stat(absolute);
    if (info.isDirectory()) {
      const glob = new Bun.Glob("**/*.playtest.ts");
      for await (const match of glob.scan({ cwd: absolute, absolute: true })) {
        files.push(match);
      }
    } else {
      files.push(absolute);
    }
  }
  if (files.length === 0) {
    throw new Error(`No *.playtest.ts files under ${inputs.join(", ")}`);
  }
  return files.toSorted();
}

/** Source for `toolkit mc playtest new`. */
export function scenarioTemplate(name: string): string {
  return `import { defineScenario } from "@shepherdjerred/mc-harness/playtest/define.ts";

export default defineScenario({
  name: ${JSON.stringify(name)},
  description: "TODO: what behavior this proves",
  requires: { profiles: ["paper"] },
  actors: { alice: { at: { x: 0, y: -60, z: 0 } } },
  // Snapshotted into region-before/after.schem.
  region: { min: { x: -8, y: -61, z: -8 }, max: { x: 8, y: -50, z: 8 } },
  async setup({ command }) {
    await command("setblock 3 -60 0 minecraft:redstone_lamp");
  },
  async run({ actors: { alice }, step, expect }) {
    await step("pull a lever next to the lamp", async () => {
      await alice.place({ x: 2, y: -60, z: 0 }, "minecraft:lever[face=floor,facing=north]");
      await alice.use({ x: 2, y: -60, z: 0 });
    });
    await expect.block({ x: 3, y: -60, z: 0 }).eventually("minecraft:redstone_lamp[lit=true]");
  },
});
`;
}
