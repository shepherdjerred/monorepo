import { z } from "zod";
import { issueCommand } from "#commands/tracker/issues.ts";
import { catalogCommand } from "#commands/tracker/catalog.ts";
import { parseTrackerArgs, required } from "#commands/tracker/options.ts";
import { trackerApi, trackerClient, trackerUrl } from "#lib/tracker/client.ts";
import { actorContext, detectActor } from "#lib/tracker/actor.ts";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";
import { identityHook } from "#lib/tracker/hooks.ts";
import { claudeModel } from "#lib/tracker/model.ts";
import { migrationCommand } from "#commands/tracker/migration.ts";

const HELP = `toolkit tracker <COMMAND> [OPTIONS]

whoami                              Show the mutation actor without writing
identity-hook claude-code|cursor     Native harness hook (JSON on stdin)
team|state|label|project list        List catalog entries (--team AI|SJ)
label create --team --name           Create a label (--color optional)
project view <slug>                  Show a project
issue list                          Filter by --team, --state, --label, --project,
                                    --priority, --assignee, --creator, --sort,
                                    --include-archived, --limit N|all, --cursor
issue search <text>                 Search open issues (--all-states optional)
issue view <ID>                      Show comments, relations, files and votes
issue create --team --title          --description or --description-file,
                                    --priority, --state, --project, --label
issue update <ID>                    Patch fields, --add-label, --remove-label,
                                    --archive|--unarchive, --expected-revision
issue delete <ID>                    Requires --expected-revision
issue comment add|list <ID>          --body or --body-file
issue comment update|delete <UUID>   Edit or remove a comment
issue vote <ID>                      --note or --remove
issue relate <ID> <TARGET>           --type blocks|blocked-by|duplicate|related
issue attach <ID> <FILE...>          Upload and commit attachments
issue events <ID>                    Show audit history
api <procedure> --input-json <JSON>  Query; --mutation adds the current actor
migration export-linear --output DIR  Export immutable Linear history and files
migration import-linear --input DIR   --dry-run, --only TYPE, --resume
migration backup-linear --input DIR   --profile seaweedfs; private, verified archive
migration verify-linear --input DIR   Fail if Linear changed since the export

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
  const config = await loadToolkitConfig();
  const url = trackerUrl(values.url ?? (await config.value("trackerUrl")));
  const actor = async () => {
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
  };
  const context = { url, actor, client: trackerClient(url) };
  let result: unknown;
  switch (subcommand) {
    case "whoami":
      result = await actor();
      break;
    case "issue":
      result = await issueCommand(context, positionals, values);
      break;
    case "migration":
      result = await migrationCommand(context, positionals, values);
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
