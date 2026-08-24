import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * The sync server layers as: `domain/` (the task model and its rules) ->
 * `engine/` (sync and reconciliation) -> `store/` (persistence) -> the HTTP
 * layer. That transport layer is three directories, not one: `routes/` holds
 * health and pomodoro, `v2/routes.ts` is the primary upstream `/api/*` plugin
 * surface, and `middleware/` wraps both. A rule naming only `routes` would
 * leave the main API unenforced. Dependencies point inward only.
 */
export default defineArchitecture({
  boundaries: [
    {
      name: "domain-is-pure",
      comment:
        "The domain model and its invariants must be exercisable without a database or an HTTP " +
        "request. Reaching into storage or a route means the rules can only be tested through " +
        "the server, and it invites request-shaped concepts into the model.",
      from: "domain",
      to: ["routes", "v2", "store", "middleware", "engine"],
    },
    {
      name: "engine-does-not-depend-on-transports",
      comment:
        "Sync and reconciliation are driven by a request, never the other way round. An engine " +
        "that imports a route or middleware cannot be run from a migration, a test harness, or " +
        "a background job.",
      from: "engine",
      to: ["routes", "v2", "middleware"],
    },
    {
      name: "store-does-not-depend-on-transports",
      comment:
        "Persistence is the inner adapter. Depending on the HTTP layer would make every read " +
        "and write reachable only from a live request.",
      from: "store",
      to: ["routes", "v2", "middleware"],
    },
  ],
});
