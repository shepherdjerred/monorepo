// Deliberate violation of emulator-does-not-depend-on-transports.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#src/webserver/index.ts";

export const illegalEmulatorDependency = true;
