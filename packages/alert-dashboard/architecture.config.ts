import { defineArchitecture } from "@shepherdjerred/architecture";

export default defineArchitecture({
  boundaries: [
    {
      name: "domain-is-pure",
      comment:
        "The domain layer holds the alerting model and its invariants. It must be usable — and " +
        "testable — without a database, an HTTP server, or a browser.",
      from: "domain",
      to: ["application", "infrastructure", "server", "client"],
    },
    {
      name: "application-does-not-depend-on-adapters",
      comment:
        "Use cases talk to ports, never to the adapters that implement them. Depending on an " +
        "adapter directly pins a use case to one storage or transport choice.",
      from: "application",
      to: ["infrastructure", "server", "client"],
    },
    {
      name: "infrastructure-does-not-depend-on-transports",
      comment:
        "Adapters are driven by the server and the client, never the other way round. An adapter " +
        "reaching back into a transport makes it unusable from any other entry point.",
      from: "infrastructure",
      to: ["server", "client"],
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
  ],
});
