import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * Streambot is a playback core wrapped in transports.
 *
 * The core is the XState playback machine (`machine/`) and the resume state it
 * persists (`state/`). The transports are the places a human reaches it from:
 * Discord's gateway (`discord/`), the slash-command service (`commands/`), and
 * the voice assistant (`voice/`), all wired together per guild by `session/`.
 * Underneath both sit two leaves — `types/`, which is nothing but identifiers,
 * and `util/`, which is errors and logging.
 *
 * `sources/`, `streamer/`, `moderation/` and `metadata/` are deliberately not
 * ruled. They and the machine reference each other in both directions today,
 * and inventing an ordering for them here would describe an architecture the
 * code does not have.
 */
const transports = ["commands", "discord", "session", "voice"];

const everythingElse = [
  "commands",
  "config",
  "discord",
  "machine",
  "metadata",
  "moderation",
  "observability",
  "pool",
  "session",
  "sources",
  "state",
  "streamer",
  "voice",
];

export default defineArchitecture({
  boundaries: [
    {
      name: "machine-does-not-depend-on-transports",
      comment:
        "The playback machine decides what should be playing. It is driven by a transport and " +
        "never the other way round, which is what lets the e2e harness and the voice assistant " +
        "run it without a Discord gateway. Reaching into a transport also drags discord.js into " +
        "the state machine. Project a view from `machine/view.ts` and let the transport render it.",
      from: "machine",
      to: transports,
    },
    {
      name: "state-does-not-depend-on-transports",
      comment:
        "`state/` is the resume snapshot written to disk and read back at startup — before any " +
        "transport exists. Depending on one makes recovery contingent on the gateway being up.",
      from: "state",
      to: transports,
    },
    {
      name: "util-is-a-leaf",
      comment:
        "`util/` is errors, logging and timecode formatting: the bottom of the graph, imported " +
        "by everything. Anything it imports becomes a dependency of every module in the package.",
      from: "util",
      to: [...everythingElse, "types"],
    },
    {
      name: "types-is-a-leaf",
      comment:
        "`types/` declares identifiers and nothing else. It has no imports at all, which is what " +
        "lets any layer name a UserId without acquiring a dependency on that layer's neighbours.",
      from: "types",
      to: [...everythingElse, "util"],
    },
  ],
});
