// Deliberate violation of domain-is-pure.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "../src/store/pomodoro-store.ts";

export const illegalDomainDependency = true;
