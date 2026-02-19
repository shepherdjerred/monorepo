import type { Client } from "discord.js";

type WebhookResult = {
  success: boolean;
  message: string;
  data?:
    | { id: string; name: string | null; channelId: string; url: string }[]
    | { webhookId: string; webhookUrl: string }
    | { messageId: string };
};

export async function handleListWebhooks(
  client: Client,
  guildId: string | undefined,
  channelId: string | undefined,
): Promise<WebhookResult> {
  if (guildId == null || guildId.length === 0) {
    return {
      success: false,
      message: "guildId is required for listing webhooks",
    };
  }
  const guild = await client.guilds.fetch(guildId);
  let webhooks;
  if (channelId != null && channelId.length > 0) {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isTextBased() !== true || !("fetchWebhooks" in channel)) {
      return { success: false, message: "Channel does not support webhooks" };
    }
    if ("fetchWebhooks" in channel) {
      webhooks = await channel.fetchWebhooks();
    } else {
      return { success: false, message: "Channel does not support webhooks" };
    }
  } else {
    webhooks = await guild.fetchWebhooks();
  }
  const webhookList = webhooks.map((webhook) => ({
    id: webhook.id,
    name: webhook.name,
    channelId: webhook.channelId,
    url: webhook.url,
  }));
  return {
    success: true,
    message: `Found ${String(webhookList.length)} webhooks`,
    data: webhookList,
  };
}

export async function handleCreateWebhook(
  client: Client,
  channelId: string | undefined,
  name: string | undefined,
  reason: string | undefined,
): Promise<WebhookResult> {
  if (
    channelId == null ||
    channelId.length === 0 ||
    name == null ||
    name.length === 0
  ) {
    return {
      success: false,
      message: "channelId and name are required for creating a webhook",
    };
  }
  const channel = await client.channels.fetch(channelId);
  if (channel?.isTextBased() !== true || !("createWebhook" in channel)) {
    return { success: false, message: "Channel does not support webhooks" };
  }
  if (!("createWebhook" in channel)) {
    return { success: false, message: "Channel does not support webhooks" };
  }
  const webhook = await channel.createWebhook({
    name,
    ...(reason !== undefined && { reason }),
  });
  return {
    success: true,
    message: `Created webhook "${webhook.name}"`,
    data: { webhookId: webhook.id, webhookUrl: webhook.url },
  };
}

type ModifyWebhookOptions = {
  client: Client;
  webhookId: string | undefined;
  name: string | undefined;
  avatarUrl: string | undefined;
  channelId: string | undefined;
  reason: string | undefined;
};

export async function handleModifyWebhook(
  options: ModifyWebhookOptions,
): Promise<WebhookResult> {
  const { client, webhookId, name, avatarUrl, channelId, reason } = options;
  if (webhookId == null || webhookId.length === 0) {
    return {
      success: false,
      message: "webhookId is required for modifying a webhook",
    };
  }
  const webhook = await client.fetchWebhook(webhookId);
  const hasChanges =
    name !== undefined || avatarUrl !== undefined || channelId !== undefined;
  if (!hasChanges) {
    return { success: false, message: "No changes specified" };
  }
  const editOptions: Parameters<typeof webhook.edit>[0] = {};
  if (name !== undefined) {
    editOptions.name = name;
  }
  if (avatarUrl !== undefined) {
    editOptions.avatar = avatarUrl;
  }
  if (channelId !== undefined) {
    editOptions.channel = channelId;
  }
  if (reason !== undefined) {
    editOptions.reason = reason;
  }
  await webhook.edit(editOptions);
  return { success: true, message: `Updated webhook "${webhook.name}"` };
}

export async function handleDeleteWebhook(
  client: Client,
  webhookId: string | undefined,
  reason: string | undefined,
): Promise<WebhookResult> {
  if (webhookId == null || webhookId.length === 0) {
    return {
      success: false,
      message: "webhookId is required for deleting a webhook",
    };
  }
  const webhook = await client.fetchWebhook(webhookId);
  const webhookName = webhook.name;
  await webhook.delete(reason);
  return { success: true, message: `Deleted webhook "${webhookName}"` };
}

type ExecuteWebhookOptions = {
  client: Client;
  webhookId: string | undefined;
  webhookToken: string | undefined;
  content: string | undefined;
  username: string | undefined;
  avatarUrl: string | undefined;
};

export async function handleExecuteWebhook(
  options: ExecuteWebhookOptions,
): Promise<WebhookResult> {
  const { client, webhookId, webhookToken, content, username, avatarUrl } = options;
  if (
    webhookId == null ||
    webhookId.length === 0 ||
    webhookToken == null ||
    webhookToken.length === 0
  ) {
    return {
      success: false,
      message:
        "webhookId and webhookToken are required for executing a webhook",
    };
  }
  if (content == null || content.length === 0) {
    return {
      success: false,
      message: "content is required for executing a webhook",
    };
  }
  const webhook = await client.fetchWebhook(webhookId, webhookToken);
  const sentMessage = await webhook.send({
    content,
    ...(username !== undefined && { username }),
    ...(avatarUrl !== undefined && { avatarURL: avatarUrl }),
  });
  return {
    success: true,
    message: "Webhook message sent",
    data: { messageId: sentMessage.id },
  };
}
