// Deliberate violation of protocol-is-standalone.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#daemon/router.ts";

export const illegalProtocolDependency = true;
