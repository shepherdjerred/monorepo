// Deliberate violation of hooks-do-not-depend-on-routes.
import "#src/routes/competition-list.tsx";

export const illegalHooksDependency = true;
