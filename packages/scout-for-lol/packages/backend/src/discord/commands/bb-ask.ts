import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { DiscordAccountId, DiscordGuildId } from "@scout-for-lol/data";
import { z } from "zod";
import {
  BucksAskUnavailableError,
  runBucksAskAgent,
} from "#src/betting/ask-agent.ts";
import { BucksAskDatasetTooLargeError } from "#src/betting/ask-analytics.ts";
import { formatInteger } from "#src/betting/display-format.ts";
import { formatBucksAskPublishCustomId } from "#src/betting/ask-custom-id.ts";
import { tryStartBucksAsk } from "#src/betting/ask-rate-limit.ts";
import { classifyLlmProviderIssue } from "#src/alerts/provider-metrics.ts";
import { LlmBudgetExceeded } from "#src/league/review/openai-budget.ts";
import { createLogger } from "#src/logger.ts";
import {
  scoutBucksAskActiveRuns,
  scoutBucksAskDurationSeconds,
  scoutBucksAskRunsTotal,
} from "#src/metrics/bucks-ask.ts";
import type { CommandEditReply } from "#src/discord/commands/define-command.ts";

export const BB_ASK_MAX_QUESTION_LENGTH = 500;
const BB_ASK_TIMEOUT_MS = 25_000;
const BUCKS_COLOR = 0x2e_cc_71;
const QuestionSchema = z.string().trim().min(1).max(BB_ASK_MAX_QUESTION_LENGTH);

const logger = createLogger("command-bb-ask");

export type BucksAskCommandInteraction = {
  id: string;
  options: Pick<ChatInputCommandInteraction["options"], "getString">;
  editReply: CommandEditReply;
};

export type BucksAskAgentRunner = (
  params: Parameters<typeof runBucksAskAgent>[0],
) => Promise<Awaited<ReturnType<typeof runBucksAskAgent>>>;

export async function replyBucksAsk(
  interaction: BucksAskCommandInteraction,
  serverId: DiscordGuildId,
  discordId: DiscordAccountId,
  dependencies: { runAgent?: BucksAskAgentRunner; timeoutMs?: number } = {},
): Promise<void> {
  const parsedQuestion = QuestionSchema.safeParse(
    interaction.options.getString("question", true),
  );
  if (!parsedQuestion.success) {
    await interaction.editReply({
      content: `Ask a Bryan Bucks question between 1 and ${formatInteger(BB_ASK_MAX_QUESTION_LENGTH)} characters.`,
    });
    return;
  }
  const question = parsedQuestion.data;

  const startedAt = Date.now();
  const ticket = tryStartBucksAsk({ userId: discordId, serverId }, startedAt);
  if (!ticket.allowed) {
    scoutBucksAskRunsTotal.inc({ status: "limited" });
    scoutBucksAskDurationSeconds.observe(
      { status: "limited" },
      (Date.now() - startedAt) / 1000,
    );
    await interaction.editReply({
      content: `${ticket.reason} Try again in about ${ticket.retryAfterSeconds.toString()} seconds.`,
    });
    return;
  }
  const allowedTicket = ticket;

  const abortSignal = AbortSignal.timeout(
    dependencies.timeoutMs ?? BB_ASK_TIMEOUT_MS,
  );
  let status = "error";
  allowedTicket.commit();
  scoutBucksAskActiveRuns.inc();
  const analysis = runAnalysis();
  void releaseWhenAnalysisSettles();
  try {
    const result = await rejectWhenAborted(analysis, abortSignal);
    const embed = new EmbedBuilder()
      .setColor(BUCKS_COLOR)
      .setTitle("Bryan Bucks analysis")
      .setDescription(result.answer)
      .addFields({ name: "Question", value: question });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          formatBucksAskPublishCustomId({ askerDiscordId: discordId }),
        )
        .setLabel("Post publicly")
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({
      embeds: [embed],
      components: [row],
      allowedMentions: { parse: [] },
    });
    status = "success";
  } catch (error) {
    status = errorStatus(error, abortSignal);
    logger.error("❌ /bb ask analysis failed", error);
    await interaction.editReply({ content: userFacingError(status) });
  } finally {
    scoutBucksAskRunsTotal.inc({ status });
    scoutBucksAskDurationSeconds.observe(
      { status },
      (Date.now() - startedAt) / 1000,
    );
  }

  function releaseTicket(): void {
    allowedTicket.finish();
    scoutBucksAskActiveRuns.dec();
  }

  async function runAnalysis() {
    return await (dependencies.runAgent ?? runBucksAskAgent)({
      runId: interaction.id,
      serverId,
      discordId,
      question,
      abortSignal,
    });
  }

  async function releaseWhenAnalysisSettles(): Promise<void> {
    try {
      await analysis;
    } catch {
      // The command path reports this failure. This observer owns only the
      // concurrency slot, including after the user-facing timeout wins.
    } finally {
      releaseTicket();
    }
  }
}

async function rejectWhenAborted<Result>(
  work: Promise<Result>,
  abortSignal: AbortSignal,
): Promise<Result> {
  if (abortSignal.aborted) {
    throw abortSignal.reason;
  }
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort?.(abortSignal.reason);
  abortSignal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    abortSignal.removeEventListener("abort", onAbort);
  }
}

function errorStatus(error: unknown, abortSignal: AbortSignal): string {
  if (abortSignal.aborted) return "timeout";
  if (error instanceof LlmBudgetExceeded) return "budget_exceeded";
  if (error instanceof BucksAskUnavailableError) return "unavailable";
  if (error instanceof BucksAskDatasetTooLargeError) return "dataset_too_large";
  return classifyLlmProviderIssue(error) === null ? "error" : "provider_error";
}

function userFacingError(status: string): string {
  switch (status) {
    case "timeout":
      return "Bryan Bucks analysis took too long. Try a narrower question.";
    case "budget_exceeded":
      return "Bryan Bucks analysis has reached its current AI budget. Try again later.";
    case "unavailable":
    case "provider_error":
      return "Bryan Bucks analysis is temporarily unavailable. Try again shortly.";
    case "dataset_too_large":
      return "This server has too much Bryan Bucks history for safe analysis right now.";
    default:
      return "I couldn't complete that Bryan Bucks analysis. Try again shortly.";
  }
}
