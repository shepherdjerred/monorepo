import { defineArchitecture } from "@shepherdjerred/architecture";

export default defineArchitecture({
  boundaries: [
    {
      name: "domain-purity",
      comment:
        "Policy decisions have no storage, network, or filesystem effects.",
      from: "domain",
      to: [
        "automation",
        "migration",
        "application",
        "infrastructure",
        "integrations",
        "filesystem",
        "server",
        "client",
      ],
    },
    {
      name: "application-ports",
      comment:
        "Application services depend on ports, never concrete transports.",
      from: "application",
      to: [
        "automation",
        "migration",
        "infrastructure",
        "integrations",
        "filesystem",
        "server",
        "client",
      ],
    },
    {
      name: "browser-boundary",
      comment:
        "Browser code consumes public contracts, never privileged modules.",
      from: "client",
      to: [
        "automation",
        "migration",
        "application",
        "infrastructure",
        "integrations",
        "filesystem",
        "server",
      ],
    },
  ],
});
