import { defineArchitecture } from "@shepherdjerred/architecture";

type LayerSpec = readonly [
  name: string,
  from: string,
  forbiddenTargets: readonly string[],
  comment: string,
];

const INCIDENTS_LAYER_SPECS: readonly LayerSpec[] = [
  [
    "shared-is-contract-only",
    "shared",
    ["domain", "infrastructure", "server", "client"],
    "Wire schemas, curated alert rules, and the Alertmanager payload stay free of domain, persistence, HTTP, and browser imports.",
  ],
  [
    "domain-is-pure",
    "domain",
    ["infrastructure", "server", "client"],
    "Lifecycle, dedupe, command claims, and signal rules are pure functions of a record, time, and settings.",
  ],
  [
    "infrastructure-is-transport-agnostic",
    "infrastructure",
    ["server", "client"],
    "Prisma and in-memory repositories and the flag reader stay below tRPC and Hono.",
  ],
  [
    "server-does-not-depend-on-client",
    "server",
    ["client"],
    "The Hub server module never imports browser pages.",
  ],
  [
    "client-imports-contract-only",
    "client",
    ["domain", "infrastructure", "server"],
    "Browser pages talk to /api/incidents using the shared contract only.",
  ],
];

export default defineArchitecture({
  boundaries: INCIDENTS_LAYER_SPECS.map(([name, from, to, comment]) => ({
    name,
    comment,
    from,
    to: [...to],
  })),
});
