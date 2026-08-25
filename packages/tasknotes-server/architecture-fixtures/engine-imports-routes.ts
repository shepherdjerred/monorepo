// Deliberate violation of engine-does-not-depend-on-transports.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "../src/routes/health.ts";

export const illegalEngineDependency = true;
