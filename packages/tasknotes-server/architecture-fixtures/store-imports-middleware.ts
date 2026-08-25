// Deliberate violation of store-does-not-depend-on-transports.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "../src/middleware/auth.ts";

export const illegalStoreDependency = true;
