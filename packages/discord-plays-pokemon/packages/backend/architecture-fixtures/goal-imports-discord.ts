// Deliberate violation of goal-does-not-depend-on-transports.
import "#src/discord/message-handler.ts";

export const illegalGoalDependency = true;
