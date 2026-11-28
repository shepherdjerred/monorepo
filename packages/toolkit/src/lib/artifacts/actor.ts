import { ActorSchema, type Actor } from "@shepherdjerred/artifacts/contract";
import {
  actorContext,
  detectActor,
  type ActorContext,
  type ActorEnvironment,
} from "#lib/tracker/actor.ts";
import { claudeModel } from "#lib/tracker/model.ts";
import { ArtifactsCliError } from "./errors.ts";

/**
 * The key a bare `wait` scopes to: the machine and the worktree (or directory)
 * the publishing agent ran in, so a resumed session in the same worktree
 * inherits undelivered feedback.
 */
export function workspaceKeyFor(context: ActorContext): string {
  return `${context.hostname}:${context.worktree ?? context.cwd}`;
}

/** Tracker's actor detection, widened with the workspace key. */
export function artifactsActorFrom(
  env: ActorEnvironment,
  context: ActorContext,
): Actor {
  let envelope: ReturnType<typeof detectActor>;
  try {
    envelope = detectActor(env, context);
  } catch (error) {
    throw new ArtifactsCliError(
      "usage",
      `Cannot identify this caller for the artifacts service: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return ActorSchema.parse({
    ...envelope,
    workspaceKey: workspaceKeyFor(context),
  });
}

/** Detect the caller from the environment, git, and the host. */
export async function detectArtifactsActor(
  env: ActorEnvironment,
  name: string,
): Promise<Actor> {
  const model = await claudeModel(env);
  return artifactsActorFrom(env, {
    ...actorContext(name),
    ...(model === undefined ? {} : { model }),
  });
}
