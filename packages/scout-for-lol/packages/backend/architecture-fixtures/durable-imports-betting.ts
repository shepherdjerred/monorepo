// Deliberate violation of durable-services-take-their-dependencies-as-arguments.
import "#src/betting/markets/postmatch-hook.ts";

export const illegalDurableDependency = true;
