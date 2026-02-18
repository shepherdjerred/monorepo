import type {
  Client,
  Message,
  MessageCreateOptions,
  TextBasedChannel,
} from "discord.js";
import { prisma } from "../../../database/index.js";
import { loggers } from "../../../utils/logger.js";

type SendableChannel = TextBasedChannel & {
  send: (options: MessageCreateOptions) => Promise<Message>;
};

const logger = loggers.tools.child("discord.polls");

type PollResult = {
  success: boolean;
  message: string;
  data?:
    | { messageId: string; pollId: string; expiresAt: string }
    | {
        question: string;
        answers: {
          id: number;
          text: string;
          emoji?: string;
          voteCount: number;
        }[];
        totalVotes: number;
        isFinalized: boolean;
        expiresAt?: string;
      };
};

export async function handleCreatePoll(options: {
  client: Client;
  channel: SendableChannel;
  channelId: string;
  question: string | undefined;
  answers: { text: string; emoji?: string | undefined }[] | undefined;
  duration: number | undefined;
  allowMultiselect: boolean | undefined;
}): Promise<PollResult> {
  const {
    client,
    channel,
    channelId,
    question,
    answers,
    duration,
    allowMultiselect,
  } = options;
  if (question == null || question.length === 0 || !answers) {
    return {
      success: false,
      message: "question and answers are required for create",
    };
  }
  const dur = duration ?? 24;
  const expiresAt = new Date(Date.now() + dur * 60 * 60 * 1000);
  const message = await channel.send({
    poll: {
      question: { text: question },
      answers: answers.map((a) => ({
        text: a.text,
        ...(a.emoji != null && a.emoji.length > 0 && { emoji: a.emoji }),
      })),
      duration: dur,
      allowMultiselect: allowMultiselect ?? false,
    },
  });
  if (
    message.guildId != null &&
    message.guildId.length > 0 &&
    message.poll != null &&
    client.user != null
  ) {
    void prisma.pollRecord
      .create({
        data: {
          guildId: message.guildId,
          channelId,
          messageId: message.id,
          pollId: message.poll.question.text ?? "",
          question,
          createdBy: client.user.id,
          expiresAt,
        },
      })
      .catch((error: unknown) => {
        logger.error("Failed to store poll", error);
      });
  }
  logger.info("Poll created", { messageId: message.id });
  return {
    success: true,
    message: `Poll created with ${answers.length.toString()} options`,
    data: {
      messageId: message.id,
      pollId: question,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

export async function handleGetPollResults(
  channel: TextBasedChannel,
  messageId: string | undefined,
): Promise<PollResult> {
  if (messageId == null || messageId.length === 0) {
    return {
      success: false,
      message: "messageId is required for get-results",
    };
  }
  const message = await channel.messages.fetch(messageId);
  if (message.poll == null) {
    return { success: false, message: "Message does not contain a poll" };
  }
  const poll = message.poll;
  let totalVotes = 0;
  const answers = [];
  for (const answer of poll.answers.values()) {
    totalVotes += answer.voteCount;
    answers.push({
      id: answer.id,
      text: answer.text ?? "",
      voteCount: answer.voteCount,
      ...(answer.emoji?.name != null &&
        answer.emoji.name.length > 0 && { emoji: answer.emoji.name }),
    });
  }
  return {
    success: true,
    message: `Poll results: ${totalVotes.toString()} total votes`,
    data: {
      question: poll.question.text ?? "",
      answers,
      totalVotes,
      isFinalized: poll.resultsFinalized,
      ...(poll.expiresAt != null && {
        expiresAt: poll.expiresAt.toISOString(),
      }),
    },
  };
}

export async function handleEndPoll(
  channel: TextBasedChannel,
  messageId: string | undefined,
): Promise<PollResult> {
  if (messageId == null || messageId.length === 0) {
    return { success: false, message: "messageId is required for end" };
  }
  const message = await channel.messages.fetch(messageId);
  if (message.poll == null) {
    return { success: false, message: "Message does not contain a poll" };
  }
  if (message.poll.resultsFinalized) {
    return { success: false, message: "Poll already finalized" };
  }
  await message.poll.end();
  logger.info("Poll ended", { messageId });
  return { success: true, message: "Poll ended and results finalized" };
}
