import { z } from "zod";
import { actorContext, detectActor } from "#lib/tracker/actor.ts";
import { claudeModel } from "#lib/tracker/model.ts";
import { trackerClient, trackerUrl } from "#lib/tracker/client.ts";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";
import { forumCommand } from "#commands/forum.ts";
import { parseForumArgs } from "#commands/forum-options.ts";

const HELP = `toolkit forum <list|search|view|post|update|reply|resolve|reopen> [ID|TEXT] [OPTIONS]

  --kind notice|discussion       Post type (required for post)
  --title TEXT --body TEXT       Post contents; --body-file PATH also supported
  --scope TAG                   Repeatable scope tags; omitted means global
  --clear-scopes                Make an existing post global
  --condition TEXT              Notice exit condition (plain text)
  --condition-file PATH         Read the exit condition from a file
  --expires-at TIMESTAMP|none   Notice expiration (ISO 8601 with timezone)
  --expected-revision N         Required for update, resolve, reopen
  --note TEXT --note-file PATH  Resolution evidence
  --state active|resolved|expired|all --all
  --limit N --cursor ID         Page results (maximum 100)
  --json --url URL --actor-key KEY --actor-kind KIND --actor-name NAME

Lists show active posts; searches include history by default. Expiration only
removes a notice from the active feed: it never performs cleanup or resolves it.
Reads need no identity; writes use the native session actor. No credentials.
`;

export async function handleForumCommand(
  action: string | undefined,
  args: string[],
): Promise<void> {
  if (
    action === undefined ||
    action === "--help" ||
    action === "-h" ||
    args.includes("--help")
  ) {
    console.log(HELP);
    return;
  }
  const { values, positionals } = parseForumArgs(args);
  const config = await loadToolkitConfig();
  const url = trackerUrl(values.url ?? (await config.value("trackerUrl")));
  const result = await forumCommand(
    {
      url,
      client: trackerClient(url),
      actor: async () => {
        const model = await claudeModel(Bun.env);
        return detectActor(
          {
            ...Bun.env,
            ...(values["actor-key"] === undefined
              ? {}
              : { TRACKER_ACTOR_KEY: values["actor-key"] }),
            ...(values["actor-kind"] === undefined
              ? {}
              : { TRACKER_ACTOR_KIND: values["actor-kind"] }),
            ...(values["actor-name"] === undefined
              ? {}
              : { TRACKER_ACTOR_NAME: values["actor-name"] }),
          },
          {
            ...actorContext(await config.value("trackerActorName")),
            ...(model === undefined ? {} : { model }),
          },
        );
      },
    },
    z
      .enum([
        "list",
        "search",
        "view",
        "post",
        "update",
        "reply",
        "resolve",
        "reopen",
      ])
      .parse(action),
    positionals,
    values,
  );
  console.log(JSON.stringify(result, null, values.json ? undefined : 2));
}
