import { actorContext, detectActor } from "./actor.ts";
import { claudeModel } from "./model.ts";
import { trackerClient, trackerUrl } from "./client.ts";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";
import { enrichActorWithHerdr } from "#lib/agent/stamp.ts";

type IdentityOptions = {
  url?: string | undefined;
  "actor-key"?: string | undefined;
  "actor-kind"?: string | undefined;
  "actor-name"?: string | undefined;
};

/** Tracker and Forum share one URL and native-session mutation identity. */
export async function trackerContext(options: IdentityOptions) {
  const config = await loadToolkitConfig();
  const url = trackerUrl(options.url ?? (await config.value("trackerUrl")));
  return {
    url,
    client: trackerClient(url),
    actor: async () => {
      const model = await claudeModel(Bun.env);
      const detected = detectActor(
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
      return enrichActorWithHerdr(detected, Bun.env);
    },
  };
}
