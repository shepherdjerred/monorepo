import type { Message, Poll } from "discord.js";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.js";
import { loggers } from "@shepherdjerred/birmel/utils/logger.js";
import { prisma } from "@shepherdjerred/birmel/database/index.js";

const logger = loggers.discord.child("polls");

export type CreatePollParams = {
  channelId: string;
  question: string;
  answers: { text: string; emoji?: string }[];
  duration?: number; // hours
  allowMultiselect?: boolean;
};

export type PollResult = {
  success: boolean;
  message: string;
  data?: {
    messageId: string;
    pollId: string;
    expiresAt: string;
  };
};

export type PollAnswer = {
  id: number;
  text: string;
  emoji?: string;
  voteCount: number;
};

export type GetPollResultsData = {
  question: string;
  answers: PollAnswer[];
  totalVotes: number;
  isFinalized: boolean;
  expiresAt?: string;
};

export async function createPoll(
  params: CreatePollParams,
): Promise<PollResult> {
  try {
    const client = getDiscordClient();
    const channel = await client.channels.fetch(params.channelId);

    if (channel?.isTextBased() !== true || !("send" in channel)) {
      return {
        success: false,
        message: "Channel must be a text channel to create a poll",
      };
    }

    const duration = params.duration ?? 24;
    const expiresAt = new Date(Date.now() + duration * 60 * 60 * 1000);

    const message: Message = await channel.send({
      poll: {
        question: {
          text: params.question,
        },
        answers: params.answers.map((answer) => ({
          text: answer.text,
          ...(answer.emoji != null &&
            answer.emoji.length > 0 && { emoji: answer.emoji }),
        })),
        duration,
        allowMultiselect: params.allowMultiselect ?? false,
      },
    });

    // Store poll metadata in database
    if (
      message.guildId != null &&
      message.guildId.length > 0 &&
      message.poll != null &&
      client.user != null
    ) {
      void (async () => {
        try {
          await prisma.pollRecord.create({
            data: {
              guildId: message.guildId,
              channelId: params.channelId,
              messageId: message.id,
              pollId: message.poll.question.text ?? "",
              question: params.question,
              createdBy: client.user.id,
              expiresAt,
            },
          });
        } catch (error: unknown) {
          logger.error("Failed to store poll record", error);
        }
      })();
    }

    logger.info("Poll created successfully", {
      messageId: message.id,
      channelId: params.channelId,
    });

    return {
      success: true,
      message: `Poll created successfully with ${params.answers.length.toString()} options`,
      data: {
        messageId: message.id,
        pollId: params.question,
        expiresAt: expiresAt.toISOString(),
      },
    };
  } catch (error) {
    logger.error("Failed to create poll", error, {
      channelId: params.channelId,
    });
    return {
      success: false,
      message: `Failed to create poll: ${(error as Error).message}`,
    };
  }
}

function extractPollResults(poll: Poll): GetPollResultsData {
  let totalVotes = 0;
  const answers: PollAnswer[] = [];

  for (const answer of poll.answers.values()) {
    totalVotes += answer.voteCount;

    const answerData: PollAnswer = {
      id: answer.id,
      text: answer.text ?? "",
      voteCount: answer.voteCount,
    };

    if (answer.emoji != null) {
      const emojiName: string | undefined =
        answer.emoji.name ?? answer.emoji.id ?? undefined;
      if (emojiName != null && emojiName.length > 0) {
        answerData.emoji = emojiName;
      }
    }

    answers.push(answerData);
  }

  return {
    question: poll.question.text ?? "",
    answers,
    totalVotes,
    isFinalized: poll.resultsFinalized,
    ...(poll.expiresAt == null
      ? {}
      : { expiresAt: poll.expiresAt.toISOString() }),
  };
}

export async function getPollResults(
  channelId: string,
  messageId: string,
): Promise<{ success: boolean; message: string; data?: GetPollResultsData }> {
  try {
    const client = getDiscordClient();
    const channel = await client.channels.fetch(channelId);

    if (channel?.isTextBased() !== true) {
      return {
        success: false,
        message: "Channel must be a text channel",
      };
    }

    const message: Message = await channel.messages.fetch(messageId);

    if (message.poll == null) {
      return {
        success: false,
        message: "Message does not contain a poll",
      };
    }

    const data = extractPollResults(message.poll);

    logger.info("Poll results fetched", {
      messageId,
      totalVotes: data.totalVotes,
      answerCount: data.answers.length,
    });

    return {
      success: true,
      message: `Poll results: ${data.totalVotes.toString()} total votes across ${data.answers.length.toString()} answers`,
      data,
    };
  } catch (error) {
    logger.error("Failed to fetch poll results", error, {
      channelId,
      messageId,
    });
    return {
      success: false,
      message: `Failed to fetch poll results: ${(error as Error).message}`,
    };
  }
}

export async function endPoll(
  channelId: string,
  messageId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const client = getDiscordClient();
    const channel = await client.channels.fetch(channelId);

    if (channel?.isTextBased() !== true) {
      return {
        success: false,
        message: "Channel must be a text channel",
      };
    }

    const message: Message = await channel.messages.fetch(messageId);

    if (message.poll == null) {
      return {
        success: false,
        message: "Message does not contain a poll",
      };
    }

    if (message.poll.resultsFinalized) {
      return {
        success: false,
        message: "Poll has already been finalized",
      };
    }

    await message.poll.end();

    logger.info("Poll ended successfully", {
      messageId,
      channelId,
    });

    return {
      success: true,
      message: "Poll ended successfully and results are now finalized",
    };
  } catch (error) {
    logger.error("Failed to end poll", error, {
      channelId,
      messageId,
    });
    return {
      success: false,
      message: `Failed to end poll: ${(error as Error).message}`,
    };
  }
}
