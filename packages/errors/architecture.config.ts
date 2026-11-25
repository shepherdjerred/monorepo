import { defineArchitecture } from "@shepherdjerred/architecture";

const architecture = defineArchitecture({
  boundaries: [
    {
      name: "shared-is-contract-only",
      comment:
        "Shared wire schemas and constants are imported by both browser and server layers and must remain pure.",
      from: "shared",
      to: ["domain", "infrastructure", "server", "client"],
    },
    {
      name: "domain-is-pure",
      comment:
        "Domain envelope parsing, fingerprinting, stacktrace formatting, and lifecycle transitions run deterministically without storage, HTTP, or UI dependencies.",
      from: "domain",
      to: ["infrastructure", "server", "client"],
    },
    {
      name: "infrastructure-is-transport-agnostic",
      comment:
        "Database, Bugsink import, outbound mail outbox, Tracker client, flag, and telemetry adapters must not depend on HTTP routes or browser UI code.",
      from: "infrastructure",
      to: ["server", "client"],
    },
    {
      name: "server-does-not-depend-on-client",
      comment:
        "Server code serves compiled static assets and must never import React or DOM client modules.",
      from: "server",
      to: ["client"],
    },
    {
      name: "client-imports-contract-only",
      comment:
        "The React SPA communicates over HTTP and must only import shared contract types and validators.",
      from: "client",
      to: ["domain", "infrastructure", "server"],
    },
  ],
});

export default architecture;
