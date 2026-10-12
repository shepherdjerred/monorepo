// Deliberate violation of playtest-is-a-daemon-client.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#bridge/client.ts";

export const illegalPlaytestDependency = true;
