export { guildTools } from "./guild.js";
export { messageTools } from "./messages.js";
export { moderationTools } from "./moderation.js";
export { channelTools } from "./channels.js";
export { roleTools } from "./roles.js";
export { memberTools } from "./members.js";
export { emojiTools } from "./emojis.js";
export { eventTools } from "./events.js";
export { webhookTools } from "./webhooks.js";
export { inviteTools } from "./invites.js";
export { automodTools } from "./automod.js";
export { pollTools } from "./polls.js";
export { threadTools } from "./threads.js";
export { activityTools } from "./activity.js";
export { schedulingTools } from "./scheduling.js";

import { guildTools } from "./guild.ts";
import { messageTools } from "./messages.ts";
import { moderationTools } from "./moderation.ts";
import { channelTools } from "./channels.ts";
import { roleTools } from "./roles.ts";
import { memberTools } from "./members.ts";
import { emojiTools } from "./emojis.ts";
import { eventTools } from "./events.ts";
import { webhookTools } from "./webhooks.ts";
import { inviteTools } from "./invites.ts";
import { automodTools } from "./automod.ts";
import { pollTools } from "./polls.ts";
import { threadTools } from "./threads.ts";
import { activityTools } from "./activity.ts";
import { schedulingTools } from "./scheduling.ts";

export const allDiscordTools = [
  ...guildTools,
  ...messageTools,
  ...moderationTools,
  ...channelTools,
  ...roleTools,
  ...memberTools,
  ...emojiTools,
  ...eventTools,
  ...webhookTools,
  ...inviteTools,
  ...automodTools,
  ...pollTools,
  ...threadTools,
  ...activityTools,
  ...schedulingTools,
];
