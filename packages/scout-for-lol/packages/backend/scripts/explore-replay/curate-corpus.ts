import { MY_SERVER } from "#src/configuration/flags.ts";
import { prisma } from "#src/database/index.ts";
import { buildTranscript } from "#src/explore/store-mappers.ts";
import {
  ReplayCorpusSchema,
  type ReplayConversationKind,
  type ReplayCorpusEntry,
  type ReplayGuildSource,
} from "#src/explore/replay/corpus.ts";
import { ExploreDurablePayloadSchema } from "#src/explore/runs/durable-payload.ts";
import type { ExploreSurface } from "#src/explore/surface.ts";
import {
  ReplayPlanError,
  resolveTurnGuilds,
  type PlanRunRow,
} from "#src/explore/replay/plan.ts";

/**
 * Candidate selection, done against a pulled snapshot.
 *
 * Loaded dynamically after the environment is aimed at that snapshot.
 */

/**
 * Conversations opened by the Dare flow rather than typed by anyone.
 *
 * Their first message is a template ("Create one private ScoutQL-backed Dare
 * v2 draft from this exact request: …"). Worth replaying, but counted apart:
 * averaged in with natural questions, template text would dominate a bundle.
 */
const DARE_DRAFT_PREFIX = "Create one private";

type Candidate = {
  readonly entry: ReplayCorpusEntry;
  readonly turns: number;
  readonly firstQuestion: string;
  readonly guildSource: ReplayGuildSource | "message-column";
};

/**
 * Which surface this *turn* provably ran on.
 *
 * Per turn, not per conversation. A replay answers each turn on the surface it
 * originally ran on, so the turn must name it. Surfaces now share one
 * capability set, but replaying a Discord turn as web would still change how
 * the answer is delivered and what the comparison measures.
 *
 * The `origin` column cannot decide it. The migration that added it defaults
 * every pre-existing row to `legacy`
 * (`20260914000000_explore_conversation_origin`), so `legacy` means "written
 * before the column" and nothing about where it came from. Worse, origin is a
 * property of the conversation: a pre-migration `/scout ask` thread continued
 * on the web later has web runs, and judging the transcript as a whole would
 * misattribute the original Discord turn.
 *
 * So each answer must name its own run. `ExploreDurablePayloadSchema.surface`
 * records it, and for rows predating that field it defaults to `web` on the
 * documented grounds that only the web surface enqueued durable runs then. A
 * turn with no run of its own has no evidence either way and is refused — the
 * same rule guild recovery already follows.
 */
function turnSurface(
  answer: { readonly id: string },
  runs: readonly PlanRunRow[],
):
  | { readonly ok: true; readonly surface: ExploreSurface }
  | { readonly ok: false; readonly reason: string } {
  const own = runs.filter((run) => run.resultMessageId === answer.id);
  if (own.length === 0) {
    return {
      ok: false,
      reason: "no durable run records the surface this turn ran on",
    };
  }
  const surfaces = new Set<ExploreSurface>();
  for (const run of own) {
    const parsed = ExploreDurablePayloadSchema.safeParse(
      JSON.parse(run.payload) as unknown,
    );
    if (!parsed.success) {
      return { ok: false, reason: "its durable run payload is unreadable" };
    }
    surfaces.add(parsed.data.surface);
  }
  const [surface, ...others] = [...surfaces];
  if (surface === undefined || others.length > 0) {
    return { ok: false, reason: "its runs disagree about the surface" };
  }
  return { ok: true, surface };
}

export async function curateCorpus(input: {
  readonly stage: "beta" | "prod";
  readonly minTurns: number;
  readonly limit: number;
  readonly write: string | null;
  readonly ownerId: string;
}): Promise<void> {
  // Beta admits exactly one guild, so a conversation there provably ran with
  // it. Prod has no allowlist and must recover from the turn or its run.
  const soleAllowedGuildId = input.stage === "beta" ? MY_SERVER : null;

  const conversations = await prisma.exploreConversation.findMany({
    where: { userId: { not: input.ownerId } },
    include: { messages: true },
    orderBy: { createdAt: "desc" },
  });
  const runs = await prisma.scoutInteractiveRun.findMany({
    where: { kind: "explore" },
    select: { conversationId: true, resultMessageId: true, payload: true },
  });
  const runsByConversation = new Map<string, PlanRunRow[]>();
  for (const run of runs) {
    if (run.conversationId === null) continue;
    const list = runsByConversation.get(run.conversationId) ?? [];
    list.push({ resultMessageId: run.resultMessageId, payload: run.payload });
    runsByConversation.set(run.conversationId, list);
  }

  const candidates: Candidate[] = [];
  const skipped: string[] = [];

  for (const conversation of conversations) {
    const leafId = conversation.currentLeafId;
    if (leafId === null) {
      skipped.push(`${conversation.id}: no leaf`);
      continue;
    }
    const transcript = buildTranscript(
      conversation,
      conversation.messages,
      leafId,
    );
    const path = transcript.messages;
    const turns: ReplayCorpusEntry["turns"] = [];
    let guildSource: Candidate["guildSource"] | null = null;
    let conversationSurface: ExploreSurface | null = null;
    let unresolvable: string | null = null;

    for (let index = 0; index * 2 + 1 < path.length; index += 1) {
      const question = path[index * 2];
      const answer = path[index * 2 + 1];
      if (question?.role !== "user" || answer?.role !== "assistant") break;
      const surface = turnSurface(
        answer,
        runsByConversation.get(conversation.id) ?? [],
      );
      if (!surface.ok) {
        unresolvable = `turn ${index.toString()}: ${surface.reason}`;
        break;
      }
      // One surface per conversation: the corpus entry replays every turn on
      // it, so a thread that moved from Discord to the web is not curated.
      if (
        conversationSurface !== null &&
        conversationSurface !== surface.surface
      ) {
        unresolvable = `turn ${index.toString()}: it ran on ${surface.surface}, earlier turns on ${conversationSurface}`;
        break;
      }
      conversationSurface = surface.surface;
      try {
        const resolved = resolveTurnGuilds({
          answer,
          runs: runsByConversation.get(conversation.id) ?? [],
          soleAllowedGuildId,
        });
        guildSource ??= resolved.source;
      } catch (error) {
        // A turn whose guild cannot be established is not curated. Running it
        // with none would strip the tools it had and read as a regression.
        unresolvable =
          error instanceof ReplayPlanError ? error.message : String(error);
        break;
      }
      turns.push({
        index,
        questionMessageId: question.id,
        answerMessageId: answer.id,
      });
    }

    if (unresolvable !== null) {
      skipped.push(`${conversation.id}: ${unresolvable.slice(0, 80)}`);
      continue;
    }
    if (
      turns.length < input.minTurns ||
      guildSource === null ||
      conversationSurface === null
    ) {
      continue;
    }

    const first = path[0]?.content ?? "";
    const kind: ReplayConversationKind = first.startsWith(DARE_DRAFT_PREFIX)
      ? "dare-draft"
      : "question";

    candidates.push({
      turns: turns.length,
      firstQuestion: first,
      guildSource,
      entry: {
        conversationId: conversation.id,
        leafId,
        kind,
        surface: conversationSurface,
        guildSource:
          guildSource === "message-column" ? "run-payload" : guildSource,
        turns,
        note: `${turns.length.toString()} turn(s), ${kind}, ${conversationSurface}`,
      },
    });
  }

  const selected = candidates
    .toSorted((left, right) => right.turns - left.turns)
    .slice(0, input.limit);

  if (input.write === null) {
    const lines = [
      `${candidates.length.toString()} replayable conversation(s) on ${input.stage}; showing ${selected.length.toString()}`,
      `${skipped.length.toString()} skipped`,
      "",
    ];
    for (const candidate of selected) {
      lines.push(
        `${candidate.entry.conversationId}  ${candidate.turns.toString()} turn(s)  ${candidate.entry.kind}  via ${candidate.guildSource}`,
        `    ${candidate.firstQuestion.replaceAll(/\s+/g, " ").slice(0, 100)}`,
      );
    }
    for (const reason of skipped.slice(0, 5)) lines.push(`  skipped ${reason}`);
    process.stdout.write(`${lines.join("\n")}\n`);
    await prisma.$disconnect();
    return;
  }

  const corpus = ReplayCorpusSchema.parse({
    version: 1,
    stage: input.stage,
    capturedAt: new Date().toISOString(),
    conversations: selected.map((candidate) => candidate.entry),
  });
  await Bun.write(input.write, `${JSON.stringify(corpus, null, 2)}\n`);
  process.stdout.write(
    `Wrote ${selected.length.toString()} conversation(s), ${selected.reduce((total, c) => total + c.turns, 0).toString()} turn(s), to ${input.write}\n`,
  );
  await prisma.$disconnect();
}
