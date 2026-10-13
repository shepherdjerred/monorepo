import type { TrackerCommandContext } from "./issues.ts";
import { required, type TrackerOptions } from "./options.ts";

export async function catalogCommand(
  context: TrackerCommandContext,
  category: string,
  args: string[],
  options: TrackerOptions,
): Promise<unknown> {
  const action = args[0];
  const teamKey = options.team;
  if (action === "list") {
    switch (category) {
      case "team":
        return context.client.teams.list.query();
      case "state":
        return context.client.states.list.query(
          teamKey === undefined ? {} : { teamKey },
        );
      case "label":
        return context.client.labels.list.query(
          teamKey === undefined ? {} : { teamKey },
        );
      case "project":
        return context.client.projects.list.query({
          includeArchived: options["include-archived"],
        });
      default:
        throw new Error(`Unknown catalog: ${category}`);
    }
  }
  if (category === "project" && action === "view")
    return context.client.projects.bySlug.query({
      slug: required(args[1], "Project slug"),
    });
  if (category === "label" && action === "create")
    return context.client.labels.create.mutate({
      actor: await context.actor(),
      teamKey: required(teamKey, "--team"),
      name: required(options.name, "--name"),
      ...(options.color === undefined ? {} : { color: options.color }),
    });
  throw new Error(
    `Unknown tracker command: ${category} ${action ?? ""}. Use tracker api for additional catalog mutations.`,
  );
}
