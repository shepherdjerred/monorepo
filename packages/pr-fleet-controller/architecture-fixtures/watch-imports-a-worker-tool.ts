// Deliberate violation of the-dashboard-only-tails-the-bundle.
// Nothing imports this file; the architecture meta-test cruises this directory
// to prove the rule can actually fail.
import "#workers/tools.ts";

export const illegalDashboardDependency = true;
