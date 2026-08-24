import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * The web app is a browser SPA with one clear direction: a route composes
 * components, components call hooks, and everything rests on `lib/`.
 *
 * `routes/` is the top of that tree. Nothing below it may import a route,
 * because a module that does can only ever be used on that one page — and it
 * drags that page's whole component tree into any bundle that touches it.
 *
 * `lib/ -> components/` is deliberately *not* forbidden yet. Two form-state
 * modules read default values and field types declared alongside the form
 * components that render them. That is the same misplacement pattern this
 * harness usually catches, but unpicking it means moving form contracts out of
 * four component files, so it is left for its own change rather than smuggled
 * in behind a rule.
 *
 * The client/server boundary is **not** expressible here. The app names the
 * backend's `AppRouter` type — three `import type` statements in `lib/trpc.ts`
 * and `lib/trpc-options.ts` — and must never import backend runtime, but each
 * cruise is scoped to its own source root on purpose (a package must not be
 * failed by a dependency's internals), so a cross-package edge is invisible to
 * this check. The boundary holds today; enforcing it needs a different
 * mechanism than `check-architecture`.
 */
export default defineArchitecture({
  boundaries: [
    {
      name: "lib-does-not-depend-on-routes-or-hooks",
      comment:
        "`lib/` is the bottom of the app: the tRPC client, query options, formatting and route " +
        "loaders. It is called by hooks and routes, never the other way round, which is what " +
        "keeps it usable from a loader that runs before any component mounts.",
      from: "lib",
      to: ["routes", "hooks"],
    },
    {
      name: "hooks-do-not-depend-on-routes",
      comment:
        "A hook that imports a route is bound to that page and cannot be reused from another. " +
        "Take what it needs as an argument, or move the shared piece into `lib/`.",
      from: "hooks",
      to: ["routes"],
    },
    {
      name: "components-do-not-depend-on-routes",
      comment:
        "A component that imports a route can only be rendered inside it, and pulls that " +
        "route's entire tree into every bundle that includes the component. Routes compose " +
        "components; the dependency runs one way.",
      from: "components",
      to: ["routes"],
    },
  ],
});
