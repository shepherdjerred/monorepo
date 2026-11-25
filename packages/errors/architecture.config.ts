import { defineArchitecture } from "@shepherdjerred/architecture";

type LayerSpec = readonly [
  name: string,
  from: string,
  forbiddenTargets: readonly string[],
  comment: string,
];

const ERRORS_LAYER_SPECS: readonly LayerSpec[] = [
  [
    "shared-is-contract-only",
    "shared",
    ["domain", "infrastructure", "server", "client"],
    "Wire contracts and DSN helpers stay free of domain, persistence, HTTP, and browser imports.",
  ],
  [
    "domain-is-pure",
    "domain",
    ["infrastructure", "server", "client"],
    "Envelope normalization, fingerprinting, and issue lifecycle rules stay pure.",
  ],
  [
    "infrastructure-is-transport-agnostic",
    "infrastructure",
    ["server", "client"],
    "Persistence, Bugsink import, mail outbox, Tracker, and telemetry adapters stay below Hono and React.",
  ],
  [
    "server-does-not-depend-on-client",
    "server",
    ["client"],
    "Hono ingest and admin servers serve built SPA assets without importing browser components.",
  ],
  [
    "client-imports-contract-only",
    "client",
    ["domain", "infrastructure", "server"],
    "Browser triage UI talks to the backend over /api/v1 using shared contract schemas only.",
  ],
];

export default defineArchitecture({
  boundaries: ERRORS_LAYER_SPECS.map(([name, from, to, comment]) => ({
    name,
    comment,
    from,
    to: [...to],
  })),
});
