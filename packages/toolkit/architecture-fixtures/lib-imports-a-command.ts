// Deliberate violation of lib-does-not-depend-on-the-cli-surface.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#commands/deployed/deployed.ts";

export const illegalLibDependency = true;
