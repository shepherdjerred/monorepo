// Deliberate violation of lib-does-not-depend-on-routes-or-hooks.
import "#src/routes/competitions/competition-list.tsx";

export const illegalLibDependency = true;
