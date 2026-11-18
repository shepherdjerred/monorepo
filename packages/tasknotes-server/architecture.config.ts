import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * The Facet sync server layers inward: `protocol/` (generated wire contract) ->
 * `v1/` (sync engine, recurrence, and store implementations) -> outer HTTP and
 * database adapters (`infrastructure/`, `routes/`, `middleware/`, `index.ts`).
 */
export default defineArchitecture({
  boundaries: [
    {
      name: "protocol-is-pure",
      comment:
        "Generated wire protocol types must remain pure data definitions with zero dependencies " +
        "on database adapters, sync handlers, routes, or middleware.",
      from: "protocol",
      to: ["infrastructure", "v1", "routes", "middleware"],
    },
    {
      name: "infrastructure-does-not-depend-on-http",
      comment:
        "Database bootstrap owns Prisma client construction only and must not import HTTP " +
        "routes, middleware, or v1 request handlers.",
      from: "infrastructure",
      to: ["v1", "routes", "middleware"],
    },
    {
      name: "v1-does-not-depend-on-outer-adapters",
      comment:
        "The `/api/v1` sync engine and stores accept an injected `PrismaClient` or run in " +
        "memory; reaching into database bootstrap, health routes, or global middleware couples " +
        "sync tests to process-global adapters.",
      from: "v1",
      to: ["infrastructure", "routes", "middleware"],
    },
  ],
});
