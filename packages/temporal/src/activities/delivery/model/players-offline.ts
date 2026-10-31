import { z } from "zod";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { workerApplicationResources } from "#lib/delivery/workers/worker-hosts.ts";
import { argoRequest } from "#activities/delivery/argocd.ts";
import {
  kubectl,
  type Command,
} from "#activities/homelab/mining-reset-kubectl.ts";
import { recordStage, stageOf } from "./stages.ts";

/** The TSMC Application whose server the gate holds; the reviewed target is fixed. */
const SERVER = "minecraft-tsmc";
const POD = "minecraft-tsmc-0";
const CONTAINER = "minecraft-tsmc";

const PodSchema = z.object({
  status: z
    .object({
      phase: z.string(),
      containerStatuses: z
        .array(z.object({ name: z.string(), ready: z.boolean() }))
        .optional(),
    })
    .optional(),
});

/** Who is connected, as the server console reports it. */
export type PlayerCount = { online: number; maximum: number };

export type PlayersOfflineEffects = {
  record: typeof recordStage;
  pods: (application: string) => Promise<unknown[]>;
  console: Command;
};

/** The console did not answer; nothing proves the server empty, so the gate keeps waiting. */
export class ConsoleUnanswered extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsoleUnanswered";
  }
}

/**
 * Paper's `list` reply. The console counts every connected player, hidden
 * staff included, unlike the public Query feed, which omits them.
 */
export function parsePlayerList(output: string): PlayerCount {
  const match =
    /^There are (?<online>\d+) of a max of (?<maximum>\d+) players online:/u.exec(
      output.trim(),
    );
  if (match?.groups === undefined)
    throw new Error("The Storm console answered list with an unknown reply");
  const online = Number(match.groups["online"]);
  const maximum = Number(match.groups["maximum"]);
  if (online > maximum)
    throw new Error("The Storm console reports more players than its maximum");
  return { online, maximum };
}

async function readPlayers(command: Command): Promise<PlayerCount> {
  const result = await command([
    "exec",
    "-n",
    "minecraft-tsmc",
    POD,
    "-c",
    CONTAINER,
    "--",
    "rcon-cli",
    "list",
  ]);
  if (result.exitCode !== 0)
    throw new ConsoleUnanswered(
      `The Storm console did not answer list (exit ${String(result.exitCode)})`,
    );
  return parsePlayerList(result.stdout);
}

const external: PlayersOfflineEffects = {
  record: recordStage,
  pods: async (application) =>
    await workerApplicationResources(application, "Pod", argoRequest),
  console: kubectl,
};

/** A server with no ready container has nobody connected to it. */
function serving(pods: unknown[]): boolean {
  return pods.some((input) => {
    const { status } = PodSchema.parse(input);
    return (
      status?.phase === "Running" &&
      status.containerStatuses?.some(
        (container) => container.name === CONTAINER && container.ready,
      ) === true
    );
  });
}

/**
 * The players-offline gate. The sync that follows restarts the server, so the
 * step waits until nobody is connected: a sleeping or unready server is empty,
 * and a serving one must report zero players on its console. While players
 * are online the running stage names their count, and the executor asks again
 * on its next tick; the empty reading is the step's evidence. A player who
 * joins between that reading and the restart is disconnected by it, as every
 * restart did before the gate.
 */
export async function runPlayersOfflineStep(
  current: DeploymentDetail,
  key: string,
  effects: PlayersOfflineEffects = external,
): Promise<{ waiting: boolean }> {
  const operationId = deliveryOperationId(
    `${current.deployment.id}:players-offline`,
  );
  if (stageOf(current, key) === undefined)
    await effects.record(current, key, "running", { operationId });
  const wait = async (reason: string) => {
    await effects.record(current, key, "running", {
      operationId,
      message: `${key}: ${reason}`,
    });
    return { waiting: true };
  };
  let reading;
  try {
    reading = serving(await effects.pods(SERVER))
      ? { server: "serving" as const, ...(await readPlayers(effects.console)) }
      : { server: "asleep" as const, online: 0 };
  } catch (error) {
    if (error instanceof ConsoleUnanswered) return await wait(error.message);
    throw error;
  }
  if (reading.online > 0)
    return await wait(
      `waiting for ${String(reading.online)} player(s) to leave`,
    );
  await effects.record(current, key, "succeeded", {
    operationId,
    evidence: [
      {
        kind: "runtime",
        operationId,
        summary: JSON.stringify({ adapter: "players-offline", ...reading }),
      },
    ],
  });
  return { waiting: false };
}
