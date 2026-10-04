import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * `protocol/` is the zod-only contract the compiled toolkit binary imports.
 * Anything it pulls in ends up in that binary, so it must never reach the
 * daemon, providers or bridge client.
 */
export default defineArchitecture({
  boundaries: [
    {
      name: "protocol-is-standalone",
      comment:
        "`protocol/` is bundled into the compiled toolkit binary. Importing the daemon, a " +
        "provider or the bridge client from it would drag Docker and server code into every " +
        "toolkit invocation.",
      from: "protocol",
      to: ["daemon", "providers", "bridge", "sandbox", "build"],
    },
  ],
});
