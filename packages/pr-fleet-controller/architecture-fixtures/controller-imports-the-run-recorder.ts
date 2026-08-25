// Deliberate violation of the-controller-does-not-own-its-io-surfaces.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#bundle/run-recorder.ts";

export const illegalControllerDependency = true;
