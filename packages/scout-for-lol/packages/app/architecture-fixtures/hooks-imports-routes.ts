// Deliberate violation of hooks-do-not-depend-on-routes-or-components.
import "#src/routes/competitions/competition-list.tsx";

export const illegalHooksDependency = true;
