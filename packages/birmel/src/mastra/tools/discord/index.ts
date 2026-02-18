export { guildTools } from "./guild.ts";
export { messageTools } from "./messages.ts";
export { moderationTools } from "./moderation.ts";
export { channelTools } from "./channels.ts";
export { roleTools } from "./roles.ts";
export { memberTools } from "./members.ts";
export { emojiTools } from "./emojis.ts";
export { eventTools } from "./events.ts";
export { webhookTools } from "./webhooks.ts";
export { inviteTools } from "./invites.ts";
export { automodTools } from "./automod.ts";
export { pollTools } from "./polls.ts";
export { threadTools } from "./threads.ts";
export { activityTools } from "./activity.ts";
export { schedulingTools } from "./scheduling.ts";

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
