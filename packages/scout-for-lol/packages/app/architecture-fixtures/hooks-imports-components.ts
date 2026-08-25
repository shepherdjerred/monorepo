// Deliberate violation of hooks-do-not-depend-on-routes-or-components.
// The sibling `hooks-imports-routes.ts` proves the `routes` half of the same
// rule; this proves the `components` half, which the rule only gained once
// `ExploreRunsContextValue` moved down to `lib/`.
import "#src/components/explore-runs-context.ts";

export const illegalHooksComponentDependency = true;
