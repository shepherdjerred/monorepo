// Deliberate violation of runtime-sits-below-every-feature-layer.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#bundle/run-recorder.ts";

export const illegalRuntimeDependency = true;
