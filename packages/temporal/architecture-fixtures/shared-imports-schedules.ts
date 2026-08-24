// Deliberate violation of shared-does-not-depend-on-the-temporal-runtime.
// A runtime import, not `import type`: the boundary permits erased imports.
import "#schedules/schedule-definitions.ts";

export const illegalSharedDependency = true;
