import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * Modules under `src/modules/<id>/`. The architecture meta-test fails when
 * this list and the directories on disk disagree, so a module can never ship
 * without its boundary.
 */
export const MODULE_IDS: readonly string[] = [];

/** The core module's inner layers, which no other module may reach into. */
const CORE_INNER_LAYERS = ["domain", "application", "infrastructure"];

/**
 * One boundary per module: it may use the platform contracts and the shared
 * UI, but not the core module's inner layers or any other module.
 *
 * A module is a single layer. The checker refuses layers in a containment
 * relationship, so `modules/<id>` cannot also declare `modules/<id>/client`
 * and `modules/<id>/server`, and `modules` as a whole cannot be a rule source
 * beside them. Each boundary needs its own negative fixture named
 * `modules-<id>-<what-it-does>.ts`.
 */
export function moduleBoundaries(ids: readonly string[]) {
  return ids.map((id) => ({
    name: `module-${id}-is-self-contained`,
    comment:
      "A module owns its own storage, API, and pages. Reaching into the core layers or another " +
      "module couples two areas that are meant to change, and be removed, independently.",
    from: `modules/${id}`,
    to: [
      ...CORE_INNER_LAYERS,
      ...ids.filter((other) => other !== id).map((other) => `modules/${other}`),
    ],
  }));
}

export default defineArchitecture({
  boundaries: [
    {
      name: "domain-is-pure",
      comment:
        "The domain layer holds the alerting model and its invariants. It must be usable — and " +
        "testable — without a database, an HTTP server, or a browser.",
      from: "domain",
      to: ["application", "infrastructure", "server", "client", "modules"],
    },
    {
      name: "application-does-not-depend-on-adapters",
      comment:
        "Use cases talk to ports, never to the adapters that implement them. Depending on an " +
        "adapter directly pins a use case to one storage or transport choice.",
      from: "application",
      to: ["infrastructure", "server", "client", "modules"],
    },
    {
      name: "infrastructure-does-not-depend-on-transports",
      comment:
        "Adapters are driven by the server and the client, never the other way round. An adapter " +
        "reaching back into a transport makes it unusable from any other entry point.",
      from: "infrastructure",
      to: ["server", "client", "modules"],
    },
    {
      name: "server-does-not-depend-on-client",
      comment:
        "Server code must not pull in browser modules; doing so drags React and the DOM into the " +
        "server bundle and breaks at runtime.",
      from: "server",
      to: ["client"],
    },
    {
      name: "client-does-not-import-server-runtime",
      comment:
        "The browser bundle may share server types over tRPC, but importing server runtime code " +
        "ships database and secret-bearing modules to the browser.",
      from: "client",
      to: ["server"],
    },
    ...moduleBoundaries(MODULE_IDS),
  ],
});
