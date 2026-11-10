import { CreateViewSchema } from "@shepherdjerred/tracker/contract";
import type { TrackerCommandContext } from "./issues.ts";
import { required, type TrackerOptions } from "./options.ts";

export async function viewCommand(
  context: TrackerCommandContext,
  args: string[],
  options: TrackerOptions,
): Promise<unknown> {
  const action = required(args[0], "View action (list, create, delete)");
  if (action === "list")
    return context.client.views.list.query(
      options.team === undefined ? {} : { teamKey: options.team },
    );
  if (action === "create") {
    const params: unknown = JSON.parse(options["input-json"] ?? "{}");
    const name = required(options.name, "--name");
    const icon = required(options.icon, "--icon");
    return context.client.views.create.mutate(
      CreateViewSchema.parse({
        actor: await context.actor(),
        name,
        icon,
        params,
        teamKey: options.team ?? null,
      }),
    );
  }
  if (action === "delete") {
    const id = required(args[1], "View ID");
    return context.client.views.delete.mutate({
      actor: await context.actor(),
      id,
    });
  }
  throw new Error(`Unknown view action: ${action}`);
}
