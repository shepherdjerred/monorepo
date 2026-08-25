// Deliberate violation of environment-adapters-do-not-drive-the-fleet.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#controller/fleet-controller.ts";

export const illegalEnvironmentDependency = true;
