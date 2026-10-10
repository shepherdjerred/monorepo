import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * `protocol/` owns standalone contracts and build-directory coordination used by the compiled toolkit binary.
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
      to: [
        "daemon",
        "providers",
        "bridge",
        "sandbox",
        "build",
        "playtest",
        "live",
      ],
    },
    {
      name: "playtest-is-a-daemon-client",
      comment:
        "Playtests run in a child process and reach targets only through the daemon socket; " +
        "they must not import the daemon, providers or the bridge client (which holds tokens).",
      from: "playtest",
      to: ["daemon", "providers", "bridge", "live"],
    },
  ],
});
