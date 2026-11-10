import { z } from "zod/v4";
import type {
  PromotionTarget,
  PromotionState,
} from "#shared/promotion/model.ts";
import type { PromotionTaskJournal } from "./publication/task.ts";
import type { PromotionTaskResult } from "./publication/task-contract.ts";
import { cleanupDiscordReply } from "./discord-cleanup.ts";
import { assertDiscordPayload } from "./publication/approved-copy.ts";
import { Messages, discordMessageText } from "./discord-messages.ts";
import {
  DiscordIndexPermissionsSchema,
  DiscordCommandPermissionFields,
  discordCommandPermission,
} from "./access/discord-permissions.ts";

import {
  DiscordCooldownError,
  throwDiscordCooldown,
} from "./access/discord-cooldown.ts";

export const PromotionDiscordToolSchema = z.discriminatedUnion("endpoint", [
  z.strictObject({ endpoint: z.literal("discord-status") }),
  z.strictObject({
    endpoint: z.literal("discord-read"),
    body: z
      .strictObject({
        limit: z.number().int().min(1).max(30).optional(),
        messageId: z.string().regex(/^\d+$/).optional(),
      })
      .optional(),
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
  canManageMessages: z.boolean(),
  moderationMfaLevel: z.enum(["NONE", "ELEVATED"]),
  accountMfaEnabled: z.boolean().nullable(),
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

/** The native toolkit daemon owns the session; this bridge pins each assignment. */
export class PromotionDiscordPreview {
  readonly preparedActions: {
    guildId: string;
    channelId: string;
    userId: string;
    operation: unknown;
  }[] = [];
  private calls = 0;
  private knownCooldown: { nextEligibleAt: string; text: string } | undefined;
  private readonly observedMessages = new Map<
    string,
    z.infer<typeof Messages>["messages"][number]
  >();
  private receipt:
    { url: string; text: string; screenshotKey: string } | undefined;
  private readonly assignment: NonNullable<PromotionTarget["discord"]>;
  constructor(
    private readonly input: {
      target: PromotionTarget;
      state?: PromotionState;
      socket: string;
      signal: AbortSignal;
      journal: PromotionTaskJournal;
      heartbeat: () => void;
      maxCalls: number;
      mode?: "run" | "preview" | "reconcile";
      approvedMessages: Promise<string[]>;
      saveEvidence?: (bytes: Uint8Array) => Promise<string>;
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
    await throwDiscordCooldown(response, path);
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
    if (
      identities.user.tag.replace(/#0$/, "") !== expected.username ||
      (this.input.mode === "run" &&
        identities.user.id !== "1560536854556839948")
    )
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
    if (
      this.input.target.id === "disboard-native-bump" &&
      this.input.mode !== "reconcile" &&
      !channel.canManageMessages
    )
      throw new Error(
        channel.moderationMfaLevel === "ELEVATED" &&
          channel.accountMfaEnabled !== true
          ? "DISBOARD cleanup requires 2FA on the outreach account because the server requires 2FA for moderation"
          : "DISBOARD requires Manage Messages for confirmation cleanup before bumping",
      );
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
          messageId: tool.body?.messageId,
        }),
      );
      if (
        result.messages.some(
          (message) => message.channelId !== context.channel.id,
        )
      )
        throw new Error("Discord read returned a foreign channel");
      const evidence = result.messages.map((message) =>
        this.observeMessage(
          message,
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
    await assertDiscordPayload(tool, this.input.approvedMessages);
    if (this.input.mode === "reconcile")
      throw new Error("Reconciliation cannot publish");
    this.preparedActions.push(plan);
    return this.input.mode === "run"
      ? await this.publish(tool, context)
      : { mode: "preview", prepared: plan, posted: false };
  }

  private async publish(
    tool: Extract<
      z.infer<typeof PromotionDiscordToolSchema>,
      { endpoint: "discord-send" | "discord-slash" }
    >,
    context: Awaited<ReturnType<PromotionDiscordPreview["inspect"]>>,
  ) {
    await this.input.journal.beforeMutation({
      key: "discord",
      text:
        tool.endpoint === "discord-send"
          ? tool.body.content
          : `/${tool.body.command}`,
    });
    await this.input.journal.beforeMutation();
    let writeAccepted = false;
    try {
      const response =
        tool.endpoint === "discord-send"
          ? await this.request("/send", {
              channelId: context.channel.id,
              content: tool.body.content,
              as: "user",
            })
          : await this.request("/slash", {
              channelId: context.channel.id,
              ...tool.body,
            });
      writeAccepted = true;
      const parsed =
        tool.endpoint === "discord-send"
          ? z.object({ messageId: z.string() }).parse(response).messageId
          : z
              .object({ reply: z.object({ id: z.string() }).nullable() })
              .parse(response).reply?.id;
      if (parsed === undefined)
        throw new Error(
          "Slash accepted without a readable reply; reconcile manually",
        );
      const readback = Messages.parse(
        await this.request("/read", {
          channelId: context.channel.id,
          limit: 30,
        }),
      );
      const message = readback.messages.find(
        (item) => item.id === parsed && item.channelId === context.channel.id,
      );
      if (
        message === undefined ||
        (tool.endpoint === "discord-send" &&
          (message.authorId !== context.identity.id ||
            message.content !== tool.body.content))
      )
        throw new Error("Discord publication has no matching readback");
      const text = discordMessageText(message);
      const url = `${this.input.target.url}/${message.id}`;
      if (this.input.saveEvidence === undefined)
        throw new Error("Discord evidence storage is unavailable");
      const evidenceKey = await this.input.saveEvidence(
        new TextEncoder().encode(JSON.stringify(message)),
      );
      this.receipt = { url, text, screenshotKey: evidenceKey };
      const observation = this.input.journal.observe({ url, text });
      return {
        posted: true,
        url,
        text,
        evidence: { observationId: observation.reference, ref: "text" },
      };
    } catch (error) {
      if (!writeAccepted && error instanceof DiscordCooldownError) {
        const { nextEligibleAt, retryAfterMs } = error.cooldown;
        const text = `Discord rejected this action due to a cooldown until ${nextEligibleAt}`;
        this.knownCooldown = { nextEligibleAt, text };
        this.input.journal.observeNativeCooldown();
        return {
          posted: false,
          status: "cooldown",
          retryAfterMs,
          nextEligibleAt,
          evidence: this.observe(text),
        };
      }
      this.input.journal.mutationFailed();
      throw error;
    }
  }

  normalizeResult(result: PromotionTaskResult): void {
    const cooldown = this.knownCooldown;
    if (cooldown === undefined) return;
    result.status = "deferred";
    result.performedAction = false;
    result.receipt = null;
    result.nextEligibleAt = cooldown.nextEligibleAt;
    result.nativeCooldownObserved = true;
    result.summary = cooldown.text;
    result.evidence = [{ url: this.input.target.url, quote: cooldown.text }];
  }

  capture() {
    if (this.receipt === undefined)
      throw new Error("Discord has no matching publication readback");
    return this.readReceipt(this.receipt.url);
  }

  selectReceipt(url: string) {
    const prefix = `${this.input.target.url}/`;
    if (!url.startsWith(prefix) || !/^\d+$/.test(url.slice(prefix.length)))
      throw new Error("Receipt is outside the assigned channel");
    this.receipt = { url, text: "", screenshotKey: "" };
  }

  async resolveReceipt(receipt: NonNullable<PromotionTaskResult["receipt"]>) {
    const url =
      receipt.url === this.input.target.url
        ? this.receiptUrl(receipt.occurrenceId)
        : receipt.url;
    this.selectReceipt(url);
    const page = await this.capture();
    // The model chooses the receipt; the parent supplies exact native text.
    return { ...receipt, url, quote: page.text.trim().slice(0, 500) };
  }

  async cleanupVerifiedReply(result: PromotionTaskResult) {
    return await cleanupDiscordReply({
      target: this.input.target,
      mode: this.input.mode,
      result,
      request: (path, body) => this.request(path, body),
    });
  }

  private observeMessage(
    message: z.infer<typeof Messages>["messages"][number],
    text: string,
  ) {
    this.observedMessages.set(message.id, message);
    const observation = this.input.journal.observe({
      url: `${this.input.target.url}/${message.id}`,
      text,
    });
    return { observationId: observation.reference, ref: "text" };
  }

  private receiptUrl(occurrenceId: string | null) {
    if (this.input.mode === "run" && this.receipt !== undefined)
      return this.receipt.url;
    const pending = this.input.state?.attempts.find(
      (attempt) =>
        attempt.occurrenceId === occurrenceId && attempt.status === "uncertain",
    );
    if (pending === undefined)
      throw new Error(
        "Receipt must identify the original uncertain occurrence",
      );
    const author = this.assignment.slash?.botId ?? "1560536854556839948";
    const candidates = [...this.observedMessages.values()].filter(
      (message) =>
        message.authorId === author &&
        Date.parse(message.createdAt) >=
          Date.parse(pending.attemptedAt) - 60_000,
    );
    const candidate = candidates[0];
    if (candidate === undefined || candidates.length !== 1)
      throw new Error("Receipt needs one fresh matching native message");
    return `${this.input.target.url}/${candidate.id}`;
  }

  private async readReceipt(url: string) {
    const id = z.string().regex(/^\d+$/).parse(url.split("/").at(-1));
    const result = Messages.parse(
      await this.request("/read", {
        channelId: this.assignment.channelId,
        limit: 30,
        messageId: id,
      }),
    );
    const author = this.assignment.slash?.botId ?? "1560536854556839948";
    const message = result.messages.find(
      (item) =>
        item.id === id &&
        item.channelId === this.assignment.channelId &&
        item.authorId === author,
    );
    if (message === undefined || this.input.saveEvidence === undefined)
      throw new Error(
        "Receipt has no fresh readback from the assigned identity",
      );
    const text = discordMessageText(message);
    const screenshotKey = await this.input.saveEvidence(
      new TextEncoder().encode(JSON.stringify(message)),
    );
    return { url, text, screenshotKey, publishedAt: message.createdAt };
  }
}
