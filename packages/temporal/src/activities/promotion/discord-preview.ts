import { z } from "zod/v4";
import type { PromotionTarget } from "#shared/promotion.ts";
import type { PromotionTaskJournal } from "./task.ts";
import {
  DiscordIndexPermissionsSchema,
  DiscordCommandPermissionFields,
  discordCommandPermission,
} from "./access/discord-permissions.ts";

export const PromotionDiscordToolSchema = z.discriminatedUnion("endpoint", [
  z.strictObject({ endpoint: z.literal("discord-status") }),
  z.strictObject({
    endpoint: z.literal("discord-read"),
    body: z.strictObject({ limit: z.number().int().min(1).max(30) }).optional(),
  }),
  z.strictObject({
    endpoint: z.literal("discord-send"),
    body: z.strictObject({ content: z.string().min(1).max(2000) }),
  }),
  z.strictObject({
    endpoint: z.literal("discord-slash"),
    body: z.strictObject({
      botId: z.string().regex(/^\d+$/),
      command: z.string().min(1),
      args: z.array(z.string()).max(20),
    }),
  }),
]);
const Status = z.object({
  identities: z.object({
    user: z.object({ id: z.string(), tag: z.string() }),
    bot: z.unknown().optional(),
  }),
});
const Channel = z.object({
  id: z.string(),
  guildId: z.string(),
  name: z.string(),
  type: z.string(),
  canView: z.boolean(),
  canSend: z.boolean(),
  canUseApplicationCommands: z.boolean(),
  canManageServer: z.boolean(),
  administrator: z.boolean(),
  memberPermissions: z.string().regex(/^\d+$/),
  slowmodeSeconds: z.number().nullable(),
});
const Commands = z.object({
  channelId: z.string(),
  guildId: z.string(),
  applications: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      permissions: DiscordIndexPermissionsSchema.optional(),
    }),
  ),
  application_commands: z.array(
    z.object({
      id: z.string(),
      application_id: z.string(),
      name: z.string(),
      description: z.string(),
      type: z.number().int(),
      ...DiscordCommandPermissionFields,
    }),
  ),
});
const Messages = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      channelId: z.string(),
      authorId: z.string(),
      authorTag: z.string(),
      content: z.string(),
      createdAt: z.string(),
      embeds: z.array(
        z.object({
          title: z.string().nullable(),
          description: z.string().nullable(),
          fields: z.array(z.object({ name: z.string(), value: z.string() })),
        }),
      ),
    }),
  ),
});

/** The native toolkit daemon owns the session; this bridge can only inspect or prepare. */
export class PromotionDiscordPreview {
  readonly preparedActions: {
    guildId: string;
    channelId: string;
    userId: string;
    operation: unknown;
  }[] = [];
  private calls = 0;
  private readonly assignment: NonNullable<PromotionTarget["discord"]>;
  constructor(
    private readonly input: {
      target: PromotionTarget;
      socket: string;
      signal: AbortSignal;
      journal: PromotionTaskJournal;
      heartbeat: () => void;
      maxCalls: number;
    },
  ) {
    if (input.target.discord === undefined)
      throw new Error("Discord assignment is missing");
    this.assignment = input.target.discord;
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`http://discord${path}`, {
        unix: this.input.socket,
        method: body === undefined ? "GET" : "POST",
        ...(body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
        signal: AbortSignal.any([
          this.input.signal,
          AbortSignal.timeout(30_000),
        ]),
      });
    } catch {
      throw new Error(
        "Outreach Discord daemon is unavailable. Run the service-account-backed start-discord.ts bootstrap; desktop 1Password is disabled.",
      );
    }
    if (!response.ok)
      throw new Error(`Discord daemon ${path} HTTP ${String(response.status)}`);
    return await response.json();
  }

  private observe(text: string) {
    const observation = this.input.journal.observe({
      url: this.input.target.url,
      text,
    });
    return { observationId: observation.reference, ref: "text" };
  }

  async inspect() {
    const expected = this.assignment;
    const { identities } = Status.parse(await this.request("/status"));
    if (identities.bot !== undefined)
      throw new Error(
        "Promotion requires an isolated user-only Discord daemon",
      );
    if (identities.user.tag.replace(/#0$/, "") !== expected.username)
      throw new Error(
        `Discord identity mismatch: expected ${expected.username}; no channel operation performed`,
      );
    const channel = Channel.parse(
      await this.request(`/channel?channelId=${expected.channelId}`),
    );
    if (
      channel.id !== expected.channelId ||
      channel.guildId !== expected.guildId
    )
      throw new Error("Discord channel is outside the assigned guild/channel");
    if (!channel.canView)
      throw new Error(
        "Assigned Discord channel is not visible to the outreach account",
      );
    const applicationCommand = await this.inspectCommand(channel);
    const evidence = this.observe(
      `Account: ${expected.username}\nGuild: ${channel.guildId}\nChannel: ${channel.name}\nChannel ID: ${channel.id}\nCan send: ${String(channel.canSend)}${applicationCommand === null ? "" : `\nApplication: ${applicationCommand.application}\nCommand: /${applicationCommand.name}\nCommand ID: ${applicationCommand.id}\nCan use application commands: true\nCommand permission: ${applicationCommand.permission.reason}\nManage Server: ${String(channel.canManageServer)}\nBot invocation: not performed`}`,
    );
    return { identity: identities.user, channel, applicationCommand, evidence };
  }

  private async inspectCommand(channel: z.infer<typeof Channel>) {
    const assigned = this.assignment.slash;
    if (assigned === undefined) return null;
    if (!channel.canUseApplicationCommands)
      throw new Error("Assigned channel does not permit application commands");
    const index = Commands.parse(
      await this.request(`/commands?channelId=${channel.id}`),
    );
    if (index.channelId !== channel.id || index.guildId !== channel.guildId)
      throw new Error("Command metadata is outside the assigned guild/channel");
    const application = index.applications.find(
      (app) => app.id === assigned.botId,
    );
    const command = index.application_commands.find(
      (entry) =>
        entry.application_id === assigned.botId &&
        entry.name === assigned.command &&
        entry.type === 1,
    );
    if (application === undefined || command === undefined)
      throw new Error(
        "Assigned bot slash command is not available in this guild",
      );
    const permission = discordCommandPermission({
      administrator: channel.administrator,
      memberPermissions: channel.memberPermissions,
      required: command.default_member_permissions,
      application: application.permissions,
      command: command.permissions,
    });
    if (!permission.allowed) throw new Error(permission.reason);
    return { ...command, application: application.name, permission };
  }

  async handle(raw: unknown): Promise<unknown> {
    const tool = PromotionDiscordToolSchema.parse(raw);
    if (++this.calls > this.input.maxCalls)
      throw new Error("Discord tool budget exhausted");
    this.input.heartbeat();
    const context = await this.inspect();
    if (tool.endpoint === "discord-status") return context;
    if (tool.endpoint === "discord-read") {
      const result = Messages.parse(
        await this.request("/read", {
          channelId: context.channel.id,
          limit: tool.body?.limit ?? 20,
        }),
      );
      if (
        result.messages.some(
          (message) => message.channelId !== context.channel.id,
        )
      )
        throw new Error("Discord read returned a foreign channel");
      const evidence = result.messages.map((message) =>
        this.observe(
          `${message.authorTag}\n${message.createdAt}\n${message.content}\n${message.embeds.map((embed) => [embed.title, embed.description, ...embed.fields.map((field) => `${field.name}: ${field.value}`)].filter(Boolean).join("\n")).join("\n")}`,
        ),
      );
      return { untrustedDiscordContent: result, evidence };
    }
    if (tool.endpoint === "discord-slash") {
      const assigned = this.assignment.slash;
      if (
        tool.body.botId !== assigned?.botId ||
        tool.body.command !== assigned.command ||
        JSON.stringify(tool.body.args) !== JSON.stringify(assigned.args)
      )
        throw new Error(
          "Slash payload does not match the caller-assigned command",
        );
    } else if (this.assignment.slash !== undefined) {
      throw new Error("This assignment requires the pinned slash command");
    } else if (!context.channel.canSend)
      throw new Error("Assigned Discord channel is read-only for this account");
    if (this.preparedActions.length > 0)
      throw new Error("One prepared Discord action per assignment");
    const plan = {
      guildId: context.channel.guildId,
      channelId: context.channel.id,
      userId: context.identity.id,
      operation: {
        kind: tool.endpoint === "discord-send" ? "message" : "slash",
        ...tool.body,
      },
    };
    this.preparedActions.push(plan);
    return { mode: "preview", prepared: plan, posted: false };
  }
}
