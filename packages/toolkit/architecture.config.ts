import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * Toolkit is a CLI: `commands/` are the user-facing verbs, `handlers/` wire
 * them to the dispatcher, and `lib/` holds the clients and helpers they are
 * built from. The direction of that dependency is the whole point — `lib/` has
 * to stay usable from a script, a test, or another command.
 */
export default defineArchitecture({
  boundaries: [
    {
      name: "lib-does-not-depend-on-the-cli-surface",
      comment:
        "`lib/` is the reusable half of the toolkit. A helper that reaches back into a command " +
        "or the dispatcher can only be called through the CLI, which makes it untestable in " +
        "isolation and couples every consumer to argument parsing.",
      from: "lib",
      to: ["commands", "handlers"],
    },
    {
      name: "types-are-pure",
      comment:
        "`types/` is the shared vocabulary the rest of the CLI is described in. It must not " +
        "depend on anything, so that a type can be imported without pulling in a client, a " +
        "command, or the dispatcher.",
      from: "types",
      to: ["commands", "handlers", "lib"],
    },
  ],
});
