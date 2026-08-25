// Deliberate violation of the-bundle-writer-does-not-import-its-readers.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#replay/run-inspection.ts";

export const illegalBundleDependency = true;
