import type { ActorEnvelope } from "@shepherdjerred/tracker/contract";
import { actorContext, detectActor } from "./actor.ts";
import { claudeModel } from "./model.ts";
import { trackerClient, trackerUrl } from "./client.ts";
import { loadToolkitConfig, type ToolkitConfig } from "#lib/toolkit-config.ts";

export type IdentityOptions = {
  url?: string | undefined;
  "actor-key"?: string | undefined;
  "actor-kind"?: string | undefined;
  "actor-name"?: string | undefined;
};

/**
 * The native-session actor every first-party write is attributed to
 * (Tracker, Forum, and incidents send the same envelope). CLI flags override
 * the `TRACKER_ACTOR_*` environment.
 */
export async function sessionActor(
  options: IdentityOptions,
  config: ToolkitConfig,
): Promise<ActorEnvelope> {
  const model = await claudeModel(Bun.env);
  return detectActor(
    {
      ...Bun.env,
      ...(options["actor-key"] === undefined
        ? {}
        : { TRACKER_ACTOR_KEY: options["actor-key"] }),
      ...(options["actor-kind"] === undefined
        ? {}
        : { TRACKER_ACTOR_KIND: options["actor-kind"] }),
      ...(options["actor-name"] === undefined
        ? {}
        : { TRACKER_ACTOR_NAME: options["actor-name"] }),
    },
    {
      ...actorContext(await config.value("trackerActorName")),
      ...(model === undefined ? {} : { model }),
    },
  );
}

/** Tracker and Forum share one URL and native-session mutation identity. */
export async function trackerContext(options: IdentityOptions) {
  const config = await loadToolkitConfig();
  const url = trackerUrl(options.url ?? (await config.value("trackerUrl")));
  return {
    url,
    client: trackerClient(url),
    actor: async () => sessionActor(options, config),
  };
}
