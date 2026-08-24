import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * The controller is a long-running process that writes an audit bundle it must
 * still be able to read back years later, from a process that never starts a
 * controller. That is the constraint the layering exists to protect: the write
 * path, the read path, and the loop that drives them all have to be separable.
 *
 * Dependencies run strictly downward through
 * `domain → runtime → {bundle → replay, workers, environment} → controller`,
 * with `watch` reading the bundle and `cli` on top wiring everything together.
 */
export default defineArchitecture({
  boundaries: [
    {
      name: "domain-depends-on-nothing",
      comment:
        "`domain/` is the vocabulary every other layer is described in — schemas, ports, the " +
        "in-memory store, and the errors that cross a boundary. It must stay importable without " +
        "dragging in a subprocess runner, a telemetry span, or an HTTP server, or a schema can no " +
        "longer be parsed from a test, a fixture, or the dashboard's type-only import.",
      from: "domain",
      to: [
        "runtime",
        "bundle",
        "replay",
        "workers",
        "environment",
        "controller",
        "watch",
        "cli",
      ],
    },
    {
      name: "runtime-sits-below-every-feature-layer",
      comment:
        "`runtime/` holds the cross-cutting primitives — telemetry capture, correlation, command " +
        "execution, file sinks. Every layer above uses them, so a primitive that reaches back up " +
        "into one of its callers turns a shared dependency into a cycle waiting to close.",
      from: "runtime",
      to: [
        "bundle",
        "replay",
        "workers",
        "environment",
        "controller",
        "watch",
        "cli",
      ],
    },
    {
      name: "the-bundle-writer-does-not-import-its-readers",
      comment:
        "`bundle/` is the append-only write path. Its output has to stay readable by a reader it " +
        "has never heard of, including one shipped later; if the writer imports `replay/` the two " +
        "can agree implicitly on a shape that is nowhere in the schema, and the v1 bundles on disk " +
        "stop being a real compatibility test.",
      from: "bundle",
      to: ["replay", "workers", "environment", "controller", "watch", "cli"],
    },
    {
      name: "replay-reads-a-bundle-not-a-live-controller",
      comment:
        "Deterministic replay is this package's core correctness property, and it is only worth " +
        "anything if it runs offline from the bundle alone. Importing `controller/`, `workers/` or " +
        "`environment/` would let a verification quietly consult the live world — git, GitHub, a " +
        "running fleet — and pass for reasons the bundle does not contain.",
      from: "replay",
      to: ["workers", "environment", "controller", "watch", "cli"],
    },
    {
      name: "worker-tools-cannot-reach-past-their-ports",
      comment:
        "`workers/` is the bounded tool surface a per-PR worker is handed, and the bound is the " +
        "point: the authority boundary in the README is only real if a tool reaches the outside " +
        "world through `domain/ports.ts`. A tool that imports `environment/` directly, or writes " +
        "to `bundle/` behind the recorder's back, escapes both the boundary and the audit trail.",
      from: "workers",
      to: ["bundle", "replay", "environment", "controller", "watch", "cli"],
    },
    {
      name: "environment-adapters-do-not-drive-the-fleet",
      comment:
        "`environment/` implements `FleetEnvironment` — git, GitHub, worktrees, the managed clone. " +
        "It answers questions the controller asks; it does not decide what to ask. An adapter that " +
        "imports `controller/` inverts that and makes the adapter unusable from a test or a script " +
        "that has no controller.",
      from: "environment",
      to: ["bundle", "replay", "workers", "controller", "watch", "cli"],
    },
    {
      name: "the-controller-does-not-own-its-io-surfaces",
      comment:
        "The master loop observes through `FleetObserver` and records through `FleetTelemetry`. " +
        "Composition — which recorder, which dashboard, whether either exists — belongs to `cli/`. " +
        "A controller that imports `bundle/` or `watch/` can no longer be driven by a test that " +
        "wants neither.",
      from: "controller",
      to: ["bundle", "replay", "watch", "cli"],
    },
    {
      name: "the-dashboard-only-tails-the-bundle",
      comment:
        "`watch/` is transport over an already-written bundle, and its single mutation is answering " +
        "a head-bound operator question through the control socket. Importing `controller/`, " +
        "`workers/` or `environment/` would give the read-only dashboard a way to act on the fleet " +
        "directly, which is exactly the authority boundary the package documents.",
      from: "watch",
      to: ["replay", "workers", "environment", "controller", "cli"],
    },
  ],
});
