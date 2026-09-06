import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * The domain package is stratified one way:
 *
 *   identity → codec → artifacts → match-processing → notifications → recovery
 *
 * A later layer may import an earlier one, never the reverse, and `identity`
 * imports nothing but zod. Each boundary lists every layer above its `from`,
 * not just the next one: "forbidden" rules do not compose transitively, so an
 * identity module importing match-processing directly would otherwise slip
 * past a rule that only named codec.
 */
export default defineArchitecture({
  boundaries: [
    {
      name: "identity-imports-nothing-but-zod",
      comment:
        "`identity` is the root layer: branded identifier schemas every other layer builds on. " +
        "It may import zod and its own siblings, nothing else — an identity brand that reaches " +
        "into a codec or a state machine drags that machinery into every consumer of the brand.",
      from: "identity",
      to: [
        "codec",
        "artifacts",
        "match-processing",
        "notifications",
        "recovery",
      ],
    },
    {
      name: "codec-serves-the-layers-above-it",
      comment:
        "`codec` defines versioned-envelope machinery for the payload layers above it. A codec " +
        "that imports a payload schema inverts that relationship and couples every codec " +
        "consumer to one payload's shape.",
      from: "codec",
      to: ["artifacts", "match-processing", "notifications", "recovery"],
    },
    {
      name: "artifacts-does-not-depend-on-processing",
      comment:
        "`artifacts` describes stored objects: keys, digests, descriptors. What the pipeline " +
        "does with an artifact — processing state, notifications, recovery — sits above it and " +
        "must not be reachable from the description of the bytes.",
      from: "artifacts",
      to: ["match-processing", "notifications", "recovery"],
    },
    {
      name: "match-processing-does-not-signal-or-recover",
      comment:
        "`match-processing` owns pipeline ownership and receipt state. Announcing outcomes " +
        "(`notifications`) and re-driving missed work (`recovery`) are built on top of that " +
        "state; importing them from here would make the state machine depend on its observers.",
      from: "match-processing",
      to: ["notifications", "recovery"],
    },
    {
      name: "notifications-does-not-depend-on-recovery",
      comment:
        "`recovery` re-drives missed work and emits notification intents while doing so. " +
        "`notifications` must stay ignorant of who minted an intent, or recovery semantics " +
        "leak into every ordinary delivery path.",
      from: "notifications",
      to: ["recovery"],
    },
  ],
});
