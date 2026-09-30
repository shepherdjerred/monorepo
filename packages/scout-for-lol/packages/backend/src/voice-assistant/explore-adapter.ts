import {
  DiscordAccountIdSchema,
  ExploreTurnRequestSchema,
  type DiscordAccountId,
  type ExploreMessage,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { exploreRunManager } from "#src/explore/runs/run-manager.ts";
import { subscribeDurableExploreRun } from "#src/explore/runs/durable-runs.ts";
import { loadExploreRunResult } from "#src/explore/store.ts";

export type VoiceExploreCompletion =
  | { outcome: "succeeded"; answer: ExploreMessage; spokenContent: string }
  | { outcome: "failed" | "stopped" | "interrupted"; answer: null };

export type StartedVoiceExplore = {
  conversationId: string;
  completion: Promise<VoiceExploreCompletion>;
};

async function waitForOutcome(
  runId: string,
  userId: DiscordAccountId,
): Promise<"succeeded" | "failed" | "stopped" | "interrupted"> {
  const deferred = Promise.withResolvers<
    "succeeded" | "failed" | "stopped" | "interrupted"
  >();
  // Voice can run on the gateway while the interactive Activity runs in the
  // application process. Observe the shared row directly so a gateway-local
  // placeholder cannot hide the worker's terminal update.
  const unsubscribe = await subscribeDurableExploreRun(
    prisma,
    runId,
    userId,
    (event) => {
      if (event.type === "done") deferred.resolve(event.outcome);
    },
  );
  if (unsubscribe === null) {
    throw new Error("Voice Explore run could not be observed");
  }
  try {
    return await deferred.promise;
  } finally {
    unsubscribe();
  }
}

async function completedVoiceExplore(input: {
  runId: string;
  conversationId: string;
  userId: DiscordAccountId;
}): Promise<VoiceExploreCompletion> {
  const outcome = await waitForOutcome(input.runId, input.userId);
  try {
    if (outcome !== "succeeded") return { outcome, answer: null };
    const result = await loadExploreRunResult(prisma, input);
    if (result === null) {
      throw new Error("Succeeded Voice Explore run has no saved answer");
    }
    if (result.spokenContent === null) {
      throw new Error("Succeeded Voice Explore run has no spoken answer");
    }
    return {
      outcome,
      answer: result.answer,
      spokenContent: result.spokenContent,
    };
  } finally {
    exploreRunManager.settleDurablePlaceholder(input.runId, outcome);
  }
}

export async function startVoiceExplore(input: {
  userId: string;
  guildId: string;
  question: string;
  conversationId: string | null;
  username: string;
  avatar: string | null;
}): Promise<StartedVoiceExplore> {
  const userId = DiscordAccountIdSchema.parse(input.userId);
  await prisma.user.upsert({
    where: { discordId: userId },
    create: {
      discordId: userId,
      discordUsername: input.username,
      discordAvatar: input.avatar,
    },
    update: {
      discordUsername: input.username,
      discordAvatar: input.avatar,
    },
  });
  const run = await exploreRunManager.start(
    { userId },
    ExploreTurnRequestSchema.parse({
      conversationId: input.conversationId,
      question: input.question,
      attach: { kind: "leaf" },
    }),
    [input.guildId],
    { surface: "voice" },
  );
  return {
    conversationId: run.conversationId,
    completion: completedVoiceExplore({
      runId: run.runId,
      conversationId: run.conversationId,
      userId,
    }),
  };
}
