// Deliberate violation of game-does-not-depend-on-transports.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#src/discord/message-handler.ts";

export const illegalGameDependency = true;
