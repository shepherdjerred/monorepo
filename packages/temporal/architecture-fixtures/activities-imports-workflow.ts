// Deliberate violation of activities-do-not-depend-on-workflows.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#workflows/data-dragon.ts";

export const illegalActivityDependency = true;
