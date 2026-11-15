import { z } from "zod";
import { trackerContext } from "#lib/tracker/context.ts";
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
  const result = await forumCommand(
    await trackerContext(values),
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
