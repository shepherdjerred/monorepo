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
export { voiceTools } from "./voice.js";

import { guildTools } from "./guild.js";
import { messageTools } from "./messages.js";
import { moderationTools } from "./moderation.js";
import { channelTools } from "./channels.js";
import { roleTools } from "./roles.js";
import { memberTools } from "./members.js";
import { emojiTools } from "./emojis.js";
import { eventTools } from "./events.js";
import { webhookTools } from "./webhooks.js";
import { inviteTools } from "./invites.js";
import { automodTools } from "./automod.js";
import { voiceTools } from "./voice.js";

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
  ...voiceTools,
];
