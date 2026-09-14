import { messageTools } from "./messages.ts";
import { eventTools } from "./events.ts";
import { pollTools } from "./polls.ts";
import { threadTools } from "./threads.ts";
import { activityTools } from "./activity.ts";

export const allDiscordTools = [
  ...messageTools,
  ...eventTools,
  ...pollTools,
  ...threadTools,
  ...activityTools,
];
