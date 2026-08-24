import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * Birmel is a set of feature slices sitting on a foundation.
 *
 * The feature slices are the bot's capabilities and the surfaces that drive
 * them: the agent runtime and its tools, the Discord gateway handlers, the
 * editor, elections, memory, music, personas, the scheduler, sessions, health
 * and context. The foundation is `config/`, `observability/`, `utils/` and the
 * Prisma repositories in `database/`.
 *
 * The enforced direction is one-way: a feature slice may use the foundation,
 * and the foundation may not reach back into a feature slice. That is the
 * direction the code already runs in, and it is what keeps a repository or a
 * logger importable from a script, a test, or any slice without dragging the
 * rest of the bot in behind it.
 *
 * `discord/` is deliberately *not* treated as infrastructure. It holds the
 * gateway event handlers — `events/message-create.ts` and friends — which are
 * the composition root that drives the features. Forbidding it from depending
 * on a feature slice would describe the inverse of what it is.
 *
 * The three foundation directories reference each other (a logger reads
 * config, config reports to observability), so no ordering is imposed among
 * them; they are ruled as a group against everything above.
 */
const featureSlices = [
  "agent-runtime",
  "agent-tools",
  "context",
  "discord",
  "editor",
  "elections",
  "health",
  "memory",
  "music",
  "persona",
  "scheduler",
  "sessions",
];

export default defineArchitecture({
  boundaries: [
    {
      name: "database-does-not-depend-on-feature-slices",
      comment:
        "`database/` is the Prisma client and its repositories. A repository that reaches into a " +
        "feature slice cannot be used by a migration script, a test fixture, or another slice " +
        "without pulling that slice's whole dependency graph — including the Discord client — in " +
        "behind it. Take what the repository needs as an argument instead.",
      from: "database",
      to: featureSlices,
    },
    {
      name: "utils-is-a-leaf",
      comment:
        "`utils/` is the logger, error helpers and image handling: the bottom of the graph, " +
        "imported by nearly every module here. Anything it imports becomes a dependency of the " +
        "entire package.",
      from: "utils",
      to: [...featureSlices, "database"],
    },
    {
      name: "observability-does-not-depend-on-feature-slices",
      comment:
        "Tracing, metrics and Sentry are cross-cutting: every slice reports to them. A slice they " +
        "report on in turn is a cycle waiting to happen, and it makes instrumentation impossible " +
        "to initialise before the thing it instruments.",
      from: "observability",
      to: [...featureSlices, "database"],
    },
    {
      name: "config-is-a-leaf",
      comment:
        "`config/` is parsed environment and constants. It is read during startup, before a " +
        "database connection or any feature exists, so it cannot depend on either.",
      from: "config",
      to: [...featureSlices, "database", "utils"],
    },
  ],
});
