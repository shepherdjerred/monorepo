import { z } from "zod";
import { issueCommand } from "#commands/tracker/issues.ts";
import { catalogCommand } from "#commands/tracker/catalog.ts";
import { viewCommand } from "#commands/tracker/views.ts";
import { parseTrackerArgs, required } from "#commands/tracker/options.ts";
import { trackerApi } from "#lib/tracker/client.ts";
import { trackerContext } from "#lib/tracker/context.ts";
import { identityHook } from "#lib/tracker/hooks.ts";

const HELP = `toolkit tracker <COMMAND> [OPTIONS]

whoami                              Show the mutation actor without writing
identity-hook claude-code|cursor     Native harness hook (JSON on stdin)
team|state|label|project list        List catalog entries (--team AI|SJ)
label create --team --name           Create a label (--color optional)
project view <slug>                  Show a project
view list                            Saved issue views (--team adds a team's)
view create --name --icon            --input-json '<list params>', --team optional
view delete <VIEW-ID>                Remove a saved view
issue list                          Filter by --team, --state, --label, --project,
                                    --priority, --urgency <high|medium|low|none>,
                                    --impact <high|medium|low|none>,
                                    --effort <xs|s|m|l|xl|none>, --assignee,
                                    --creator, --parent, --due-before,
                                    --due-after (YYYY-MM-DD), --overdue (before
                                    --today, default this machine's date),
                                    --include-archived, --sort updated|created|
                                    priority|urgency|impact|effort|votes|board|
                                    due, --limit N|all, --cursor
issue search <text>                 Search open issues (--all-states optional)
issue view <ID>                      Show parent, sub-issues, due date, comments,
                                    relations, files and votes
issue create --team --title          --description or --description-file,
                                    --priority <0..4|auto>,
                                    --urgency <high|medium|low>,
                                    --impact <high|medium|low>,
                                    --effort <xs|s|m|l|xl>, --state, --project,
                                    --label, --parent <ID>, --due <YYYY-MM-DD>
issue update <ID>                    Patch fields, --priority <0..4|auto>,
                                    --urgency <high|medium|low|none>,
                                    --impact <high|medium|low|none>,
                                    --effort <xs|s|m|l|xl|none>, --add-label,
                                    --remove-label, --parent <ID|none>,
                                    --due <YYYY-MM-DD|none>,
                                    --archive|--unarchive, --expected-revision
issue bulk-update <ID...>            One all-or-nothing patch: --state,
                                    --priority <0..4|auto>, --urgency, --impact,
                                    --effort, --project, --assignee,
                                    --add-label, --remove-label, --parent,
                                    --due, --archive|--unarchive
issue delete <ID>                    Requires --expected-revision
issue comment add|list <ID>          --body or --body-file
issue comment update|delete <UUID>   Edit or remove a comment
issue vote <ID>                      --note or --remove
issue relate <ID> <TARGET>           --type blocks|blocked-by|duplicate|related
issue attach <ID> <FILE...>          Upload and commit attachments
issue events <ID>                    Show audit history
api <procedure> --input-json <JSON>  Query; --mutation adds the current actor

All commands accept --json, --url, --actor-key, --actor-kind, --actor-name.
Reads do not require an actor. Noninteractive mutations require a native agent
session or explicit TRACKER_ACTOR_KEY and TRACKER_ACTOR_KIND. No credentials.
`;

export async function handleTrackerCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (
    subcommand === undefined ||
    subcommand === "--help" ||
    subcommand === "-h" ||
    args.includes("--help")
  ) {
    console.log(HELP);
    return;
  }
  const { values, positionals } = parseTrackerArgs(args);
  if (subcommand === "identity-hook") {
    console.log(
      JSON.stringify(
        await identityHook(
          required(positionals[0], "Harness"),
          JSON.parse(await Bun.stdin.text()),
          Bun.env,
        ),
      ),
    );
    return;
  }
  const context = await trackerContext(values);
  const { url, actor } = context;
  let result: unknown;
  switch (subcommand) {
    case "whoami":
      result = await actor();
      break;
    case "issue":
      result = await issueCommand(context, positionals, values);
      break;
    case "view":
      result = await viewCommand(context, positionals, values);
      break;
    case "api": {
      const procedure = required(positionals[0], "Procedure name");
      const input = z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(values["input-json"] ?? "{}"));
      const api = trackerApi(url);
      result = values.mutation
        ? await api.mutation(procedure, { ...input, actor: await actor() })
        : await api.query(procedure, input);
      break;
    }
    default:
      result = await catalogCommand(context, subcommand, positionals, values);
  }
  console.log(JSON.stringify(result, null, values.json ? undefined : 2));
}
