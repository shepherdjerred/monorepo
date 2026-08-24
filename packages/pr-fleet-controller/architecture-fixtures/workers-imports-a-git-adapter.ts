// Deliberate violation of worker-tools-cannot-reach-past-their-ports.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#environment/git-operations.ts";

export const illegalWorkerDependency = true;
