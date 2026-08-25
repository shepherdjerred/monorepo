// Deliberate violation of replay-reads-a-bundle-not-a-live-controller.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#exec/process-runner.ts";

export const illegalReplayDependency = true;
