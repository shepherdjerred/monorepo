import { z } from "zod/v4";
import type { PromotionTarget } from "#shared/promotion.ts";
import type { PromotionTaskJournal } from "./task.ts";

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
  slowmodeSeconds: z.number().nullable(),
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
    const evidence = this.observe(
      `Account: ${expected.username}\nGuild: ${channel.guildId}\nChannel: ${channel.name}\nChannel ID: ${channel.id}\nCan send: ${String(channel.canSend)}`,
    );
    return { identity: identities.user, channel, evidence };
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
    if (!context.channel.canSend)
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
