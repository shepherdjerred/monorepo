import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * The core of this bot is an emulator and the game state driven from it.
 * Discord, the web server, and the Go-Live stream are three interchangeable
 * ways to watch and control that core — none of them may be baked into it.
 *
 * `goal/` is the autonomous player, a fourth way to drive the same core, so it
 * is held to the same rule. The chord validator and executor it needed used to
 * sit under `discord/` despite being pure functions over `game/command/`'s
 * `Chord` — the validator's own comment says it exists so the goal bot and
 * Discord chat users can pass different limits through one implementation.
 * They now live in `game/command/` beside the type they operate on, which is
 * what makes this rule expressible.
 */
export default defineArchitecture({
  boundaries: [
    {
      name: "emulator-does-not-depend-on-transports",
      comment:
        "The emulator drives a ROM and exposes frames and inputs. A transport import inside it " +
        "means the emulator can only run when Discord, the web server, or the stream is up — " +
        "including in tests and in headless benchmark runs.",
      from: "emulator",
      to: ["discord", "webserver", "stream"],
    },
    {
      name: "game-does-not-depend-on-transports",
      comment:
        "Game state and command handling are the rules of play. They are consumed by the " +
        "transports, so depending on one inverts the relationship and makes the rules " +
        "untestable without a live client.",
      from: "game",
      to: ["discord", "webserver", "stream"],
    },
    {
      name: "goal-does-not-depend-on-transports",
      comment:
        "The goal bot drives the game over its own control server; it is a peer of the human " +
        "transports, not a client of one. Reaching into `discord/` would make an autonomous run " +
        "— including a headless benchmark — require a live Discord gateway. Anything both it and " +
        "a human transport need is a game primitive and belongs under `game/`.",
      from: "goal",
      to: ["discord", "webserver", "stream"],
    },
  ],
});
