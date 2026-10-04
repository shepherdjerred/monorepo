import {
  type ActorAction,
  ActorActionResponseSchema,
  ActorListResponseSchema,
  ActorObservationSchema,
  ActorRemoveResponseSchema,
  ActorSchema,
  type ActorSpawnRequest,
} from "@shepherdjerred/mc-harness/protocol/bridge.ts";
import { daemonRequest } from "#lib/mc/client.ts";
import {
  renderActor,
  renderActorAction,
  renderActors,
  renderObservation,
} from "#lib/mc/play.ts";
import { resolveTarget } from "#lib/mc/target.ts";

export type ActorOptions = { target: string | undefined; json: boolean };

async function actorsPath(options: ActorOptions, rest = ""): Promise<string> {
  const id = await resolveTarget(options.target);
  return `/targets/${encodeURIComponent(id)}/actors${rest}`;
}

function print<T>(json: boolean, value: T, render: (value: T) => string): void {
  console.log(json ? JSON.stringify(value, null, 2) : render(value));
}

export async function mcActorSpawnCommand(
  options: ActorOptions,
  spawn: ActorSpawnRequest,
): Promise<void> {
  const actor = await daemonRequest(
    ActorSchema,
    "POST",
    await actorsPath(options),
    spawn,
  );
  print(options.json, actor, renderActor);
}

export async function mcActorListCommand(options: ActorOptions): Promise<void> {
  const { actors } = await daemonRequest(
    ActorListResponseSchema,
    "GET",
    await actorsPath(options),
  );
  print(options.json, actors, renderActors);
}

export async function mcActorObserveCommand(
  options: ActorOptions,
  name: string,
): Promise<void> {
  const observation = await daemonRequest(
    ActorObservationSchema,
    "GET",
    await actorsPath(options, `/${encodeURIComponent(name)}`),
  );
  print(options.json, observation, renderObservation);
}

export async function mcActorActCommand(
  options: ActorOptions,
  name: string,
  action: ActorAction,
  body: unknown,
): Promise<void> {
  const result = await daemonRequest(
    ActorActionResponseSchema,
    "POST",
    await actorsPath(options, `/${encodeURIComponent(name)}/${action}`),
    body,
  );
  print(options.json, result, renderActorAction);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

export async function mcActorQuitCommand(
  options: ActorOptions,
  names: readonly string[],
  all: boolean,
): Promise<void> {
  let targets = names;
  if (all) {
    const listed = await daemonRequest(
      ActorListResponseSchema,
      "GET",
      await actorsPath(options),
    );
    targets = listed.actors.map((actor) => actor.name);
  }
  for (const name of targets) {
    const { removed } = await daemonRequest(
      ActorRemoveResponseSchema,
      "DELETE",
      await actorsPath(options, `/${encodeURIComponent(name)}`),
    );
    console.log(`removed ${removed}`);
  }
  if (targets.length === 0) {
    console.log("No actors.");
  }
}
