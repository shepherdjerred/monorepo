// Deliberate violation of process-execution-is-a-leaf.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#controller/fleet-controller.ts";

export const illegalExecDependency = true;
