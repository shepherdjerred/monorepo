import { GatewayIntentBits, Partials } from "discord.js";

export const GATEWAY_INTENTS = [
  // Core functionality
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent, // PRIVILEGED

  // Member management
  GatewayIntentBits.GuildMembers, // PRIVILEGED
  GatewayIntentBits.GuildModeration,

  // Voice functionality
  GatewayIntentBits.GuildVoiceStates,

  // Additional features
  GatewayIntentBits.GuildPresences, // PRIVILEGED
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildScheduledEvents,
  GatewayIntentBits.GuildIntegrations,
  GatewayIntentBits.GuildWebhooks,
  GatewayIntentBits.GuildInvites,
  GatewayIntentBits.DirectMessages,
] as const;

export const PARTIALS = [
  Partials.Message,
  Partials.Channel,
  Partials.Reaction,
  Partials.User,
  Partials.GuildMember,
] as const;
