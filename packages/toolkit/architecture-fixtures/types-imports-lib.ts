// Deliberate violation of types-are-pure.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#lib/output/formatter.ts";

export const illegalTypesDependency = true;
