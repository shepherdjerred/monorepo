import { trackerContext } from "#lib/tracker/context.ts";
import { forumCommand } from "#commands/forum.ts";
import { ForumActionSchema, parseForumArgs } from "#commands/forum-options.ts";
import { watchForum } from "#commands/forum-watch.ts";

const HELP = `toolkit forum <COMMAND> [ID|TEXT] [OPTIONS]

Commands:
  list | search <TEXT> | inbox | scopes | view <ID>
  post | update <ID> | resolve <ID> | reopen <ID> | pin <ID> | unpin <ID>
  reply <ID> | edit-reply <REPLY_ID> | delete-reply <REPLY_ID>
  accept <ID> <REPLY_ID> | unaccept <ID>
  claim <ID> | handoff <ID> --to KEY|me|none
  vote [ID] | unvote [ID] | react [ID] --emoji EMOJI | unreact [ID] --emoji EMOJI
  subscribe <ID> [--mute] | unsubscribe <ID> | read <ID> [--unread]
  link <ID> <ISSUE> [--reply REPLY_ID] | unlink <ID> <ISSUE> | promote <ID>
  watch [ID] [--once] [--until-resolved] [--timeout-sec N]

Options:
  --kind notice|discussion|question|decision   Post kind (required for post)
  --title TEXT --body TEXT --body-file PATH    Post, reply, or promoted issue content
  --scope TAG --clear-scopes                   Repeatable scope tags; omitted means global
  --condition TEXT --condition-file PATH       Notice exit condition (required on notice)
  --expires-at TIMESTAMP|none                  Notice expiration (ISO 8601 with timezone)
  --owner KEY|me|none --creator KEY|me         Notice coordination owner / creator filter
  --project SLUG|none --issue IDENTIFIER       Project reference / linked issue(s)
  --pinned --parent-reply UUID --reply UUID    Pin on post / parent or target reply UUID
  --attach PATH                                Upload and commit attachment(s) (repeatable)
  --emoji 👍|👎|🎉|❤️|🚀|👀|🤔|✅              Reaction emoji
  --team KEY --priority 0-4                    Team (default AI) and priority for promote
  --expected-revision N                        Required for update, resolve, reopen
  --note TEXT --note-file PATH                 Resolution, claim, handoff, or vote note
  --state active|open|resolved|expired|answered|unanswered|pinned|all --all
  --sort activity|newest|votes|replies --unread --subscribed
  --limit N --cursor ID                        Page results (maximum 100)
  --json --url URL --actor-key KEY --actor-kind KIND --actor-name NAME

Every <ID> accepts FM-<N> (e.g. FM-12) or a post UUID. Lists show active posts;
searches include history by default. Reads need no identity; writes use the
native session actor. Use watch --until-resolved <FM-N> instead of polling.
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
  if (action === "watch") {
    await watchForum(await trackerContext(values), positionals, values);
    return;
  }
  const result = await forumCommand(
    await trackerContext(values),
    ForumActionSchema.parse(action),
    positionals,
    values,
  );
  console.log(JSON.stringify(result, null, values.json ? undefined : 2));
}
