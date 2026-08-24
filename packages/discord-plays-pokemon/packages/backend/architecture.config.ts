import { defineArchitecture } from "@shepherdjerred/architecture";

/**
 * The core of this bot is an emulator and the game state driven from it.
 * Discord, the web server, and the Go-Live stream are three interchangeable
 * ways to watch and control that core — none of them may be baked into it.
 *
 * `goal/` is not covered yet: `goal/control-routes.ts` uses the chord
 * validator and executor, which live under `discord/` but are really input
 * primitives. Ruling that boundary means relocating them first.
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
  ],
});
