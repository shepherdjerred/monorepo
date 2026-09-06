// Deliberate violation of lib-does-not-depend-on-the-temporal-runtime.
// A runtime import, not `import type`: the boundary permits erased imports.
import "#activities/reports/report-delivery.ts";

export const illegalLibDependency = true;
