// Deliberate violation of domain-depends-on-nothing.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#runtime/process-runner.ts";

export const illegalDomainDependency = true;
