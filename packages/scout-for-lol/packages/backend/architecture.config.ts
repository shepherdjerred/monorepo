import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * The backend is domain-sliced, not cleanly stratified, and these rules
 * describe the part of it that genuinely is one-way.
 *
 * What is enforced is the outside of the graph. The cross-cutting layers
 * (`configuration/`, `observability/`, `utils/`, `metrics/`) sit underneath
 * everything and must not reach back up. The persistence layers (`database/`,
 * `storage/`, `report-store/`) are driven by the application and must not
 * reach into it or into a transport. `analytics/` is a read-only query layer
 * over the database. `http/` is the composition root for the tRPC handler and
 * a small, named set of HTTP-specific endpoint adapters.
 *
 * What is deliberately *not* enforced is a transport boundary around the
 * domain. `league/tasks/` schedules work that posts to Discord, `betting/`
 * announces settlements, and `discord/` in turn drives most of the domain:
 * those directories are simultaneously the domain and its composition root.
 * A `domain must not import a transport` rule would be a redesign proposal,
 * not a description, and this package is in live beta. It is written up in the
 * pull request rather than half-declared here.
 *
 * `configuration/` never appears in a `to` list either, for the opposite
 * reason: parsed deployment settings are read during startup by every layer
 * here, so forbidding it would forbid the thing it exists for. Note that the
 * layer is `src/configuration/` *and* `src/configuration.ts` — the root module
 * is the bulk of it, and a rule that covered only the directory would let the
 * layer import anything it liked through its own front door.
 *
 * `testing/` never appears in a `to` list. It is fixture and harness code that
 * only test files should use, but dependency-cruiser cruises a `.test.ts` like
 * any other module, so a rule forbidding it would forbid the tests that are
 * supposed to use it.
 */

/** Every directory directly under `src/`. Adding one here covers every rule below. */
const layers = [
  "alerts",
  "analytics",
  "betting",
  "config",
  "configuration",
  "database",
  "discord",
  "explore",
  "http",
  "league",
  "lib",
  "metrics",
  "observability",
  "report-lake",
  "report-store",
  "reports",
  "showcase",
  "sound-engine",
  "storage",
  "testing",
  "trpc",
  "utils",
  "voice",
];

/**
 * Everything a layer may not depend on, written as what it *may*.
 *
 * Spelling the allowance rather than the prohibition is what keeps these rules
 * closed-world: a directory added to `layers` is forbidden by every rule that
 * does not name it, instead of being quietly uncovered.
 */
function everythingExcept(...allowed: string[]): string[] {
  return layers.filter(
    (layer) => layer !== "testing" && !allowed.includes(layer),
  );
}

export default defineArchitecture({
  boundaries: [
    {
      name: "configuration-is-a-leaf",
      comment:
        "`configuration/` parses the deployment's settings and is read during startup, before a " +
        "database connection, a Discord client or any feature exists. It has no imports of its " +
        "own and must keep none.",
      from: "configuration",
      to: everythingExcept("configuration"),
    },
    {
      name: "observability-is-a-leaf",
      comment:
        "Tracing and error reporting are installed before the thing they observe. Importing any " +
        "part of the application inverts that and makes instrumentation contingent on what it " +
        "is supposed to be watching.",
      from: "observability",
      to: everythingExcept("observability"),
    },
    {
      name: "utils-does-not-depend-on-the-application",
      comment:
        "`utils/` is at the bottom of the graph and is imported almost everywhere, so anything " +
        "it imports becomes a dependency of nearly every module in the backend. Only `metrics/` " +
        "is permitted, for the circuit breaker's counters.",
      from: "utils",
      to: everythingExcept("utils", "metrics", "configuration"),
    },
    {
      name: "metrics-does-not-depend-on-the-domain",
      comment:
        "Metric definitions are cross-cutting: every layer records to them. Reaching into a " +
        "feature to compute a metric couples the registry to that feature's startup order. " +
        "`database/` is permitted for pool gauges and `alerts/` for the rules built on top.",
      from: "metrics",
      to: everythingExcept("metrics", "alerts", "configuration", "database"),
    },
    {
      name: "database-does-not-depend-on-transports-or-the-domain",
      comment:
        "The Prisma layer is driven by the application, never the other way round. A repository " +
        "that reaches into `discord/`, `trpc/` or a feature slice cannot be used from a " +
        "migration script, a fixture or another slice without dragging that slice in behind it.",
      from: "database",
      to: everythingExcept(
        "database",
        "configuration",
        "lib",
        "metrics",
        "utils",
      ),
    },
    {
      name: "storage-does-not-depend-on-the-domain-or-transports",
      comment:
        "`storage/` is the S3 adapter layer: buckets, keys and object metadata. It is called by " +
        "the domain and must not call back into it. `report-lake/` is permitted because it is " +
        "the lake's on-disk layout, which is a storage concern rather than a feature.",
      from: "storage",
      to: everythingExcept(
        "storage",
        "metrics",
        "report-lake",
        "utils",
        "configuration",
      ),
    },
    {
      name: "report-store-does-not-depend-on-the-domain-or-transports",
      comment:
        "The report store persists and retrieves rendered reports. Like `storage/` it is a " +
        "persistence layer beneath the features that produce those reports, so it may reach the " +
        "lake and the object store but not the code that decides what to write.",
      from: "report-store",
      to: everythingExcept(
        "report-store",
        "metrics",
        "report-lake",
        "storage",
        "utils",
        "configuration",
      ),
    },
    {
      name: "analytics-reads-the-database-and-nothing-else",
      comment:
        "`analytics/` answers questions about stored data. Keeping it to the database means an " +
        "analytics query can be run from a script or a test without a Discord client, a tRPC " +
        "context or a report pipeline, which is the whole reason it is a separate slice.",
      from: "analytics",
      to: everythingExcept(
        "analytics",
        "database",
        "metrics",
        "utils",
        "configuration",
      ),
    },
    {
      name: "http-is-limited-to-its-endpoint-adapters",
      comment:
        "`http/` mounts the tRPC handler plus the health, Explore stream, report AI and weekly " +
        "parlay endpoints. Those adapters are its complete direct application surface; a new " +
        "feature or repository must join tRPC or be introduced explicitly as an HTTP endpoint.",
      from: "http",
      to: everythingExcept(
        "http",
        "trpc",
        "configuration",
        "metrics",
        "database",
        "explore",
        "reports",
        "betting",
      ),
    },
  ],
});
