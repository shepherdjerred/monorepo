import { defineArchitecture } from "@shepherdjerred/architecture";

export default defineArchitecture({
  boundaries: [
    {
      name: "domain-purity",
      comment: "Domain rules run without a transport or storage adapter.",
      from: "domain",
      to: ["application", "infrastructure", "server", "client"],
    },
    {
      name: "application-ports",
      comment: "Application ports do not import their implementations.",
      from: "application",
      to: ["infrastructure", "server", "client"],
    },
    {
      name: "adapter-independence",
      comment: "Storage adapters are reusable outside the HTTP server.",
      from: "infrastructure",
      to: ["server", "client"],
    },
    {
      name: "server-independence",
      comment: "The server cannot import browser runtime modules.",
      from: "server",
      to: ["client"],
    },
    {
      name: "browser-contract",
      comment: "Only server types cross into the browser bundle.",
      from: "client",
      to: ["server"],
    },
  ],
});
