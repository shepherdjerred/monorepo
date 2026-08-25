import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * The controller is a long-running process that writes an audit bundle it must
 * still be able to read back years later, from a process that never starts a
 * controller. That is the constraint the layering exists to protect: the write
 * path, the read path, and the loop that drives them all have to be separable.
 *
 * Dependencies run strictly downward through
 * `domain → runtime → {exec, bundle → replay, workers} → environment → controller`,
 * with `watch` reading the bundle and `cli` on top wiring everything together.
 *
 * Two structural rules make the boundaries below total rather than
 * approximate, and both are load-bearing:
 *
 * - **No module sits directly under `src/`.** `from` and `to` name directories,
 *   so a module outside every layer is a module no rule can reach. The public
 *   composition entry lives in `controller/` for exactly that reason.
 * - **Process execution is its own layer.** `exec/` is the only place
 *   `Bun.spawn` is reachable from. Folding it into `runtime/` would have let
 *   any layer that legitimately needs a telemetry primitive also shell out.
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
        "exec",
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
        "`runtime/` holds the cross-cutting primitives — telemetry capture, correlation, file " +
        "sinks. Every layer above uses them, so a primitive that reaches back up into one of its " +
        "callers turns a shared dependency into a cycle waiting to close. It must also stay free " +
        "of `exec/`, so that needing a span never transitively grants the ability to spawn.",
      from: "runtime",
      to: [
        "exec",
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
      name: "process-execution-is-a-leaf",
      comment:
        "`exec/` is the only module group from which `Bun.spawn` is reachable, which is what lets " +
        "every other boundary treat 'may not import exec' as 'may not run a command'. It answers " +
        "callers and never chooses work, so it must not import a layer above it.",
      from: "exec",
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
      to: [
        "exec",
        "replay",
        "workers",
        "environment",
        "controller",
        "watch",
        "cli",
      ],
    },
    {
      name: "replay-reads-a-bundle-not-a-live-controller",
      comment:
        "Deterministic replay is this package's core correctness property, and it is only worth " +
        "anything if it runs offline from the bundle alone. `exec/` is forbidden alongside the " +
        "higher layers because it is the narrowest statement of that: without it a verification " +
        "could shell out to git or gh and still be certified as offline.",
      from: "replay",
      to: ["exec", "workers", "environment", "controller", "watch", "cli"],
    },
    {
      name: "worker-tools-cannot-reach-past-their-ports",
      comment:
        "`workers/` is the bounded tool surface a per-PR worker is handed, and the bound is the " +
        "point: the authority boundary in the README is only real if a tool reaches the outside " +
        "world through `domain/ports.ts`. A tool that imports `environment/` or `exec/` directly, " +
        "or writes to `bundle/` behind the recorder's back, escapes both the boundary and the " +
        "audit trail.",
      from: "workers",
      to: [
        "exec",
        "bundle",
        "replay",
        "environment",
        "controller",
        "watch",
        "cli",
      ],
    },
    {
      name: "environment-adapters-do-not-drive-the-fleet",
      comment:
        "`environment/` implements `FleetEnvironment` — git, GitHub, worktrees, the managed clone. " +
        "It answers questions the controller asks; it does not decide what to ask. An adapter that " +
        "imports `controller/` inverts that and makes the adapter unusable from a test or a script " +
        "that has no controller. It may import `exec/`: running commands is what it is for.",
      from: "environment",
      to: ["bundle", "replay", "workers", "controller", "watch", "cli"],
    },
    {
      name: "the-controller-does-not-own-its-io-surfaces",
      comment:
        "The master loop observes through `FleetObserver`, records through `FleetTelemetry`, and " +
        "reaches the world through `FleetEnvironment`. Composition — which recorder, which " +
        "dashboard, whether either exists — belongs to `cli/`, and commands belong to the adapter " +
        "behind the port. A controller that imports `bundle/`, `watch/` or `exec/` can no longer " +
        "be driven by a test that wants none of them.",
      from: "controller",
      to: ["exec", "bundle", "replay", "watch", "cli"],
    },
    {
      name: "the-dashboard-only-tails-the-bundle",
      comment:
        "`watch/` is transport over an already-written bundle, and its single mutation is answering " +
        "a head-bound operator question through the control socket. Importing `controller/`, " +
        "`workers/`, `environment/` or `exec/` would give the read-only dashboard a way to act on " +
        "the fleet directly, which is exactly the authority boundary the package documents.",
      from: "watch",
      to: ["exec", "replay", "workers", "environment", "controller", "cli"],
    },
  ],
});
