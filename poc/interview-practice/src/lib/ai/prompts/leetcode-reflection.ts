import type { LeetcodeQuestion, QuestionPart } from "#lib/questions/schemas.ts";
import type { TranscriptEntry } from "#lib/db/transcript.ts";
import type { TimerPhase } from "#lib/timer/schemas.ts";

export type ReflectionPromptContext = {
  question: LeetcodeQuestion;
  currentPart: QuestionPart;
  totalParts: number;
  timerDisplay: string;
  timerPhase: TimerPhase;
  hintsGiven: number;
  testsRun: number;
  recentTranscript: TranscriptEntry[];
  codeSnapshot: string | null;
};

export function buildReflectionSystemPrompt(
  ctx: ReflectionPromptContext,
): string {
  const sections: string[] = [];

  sections.push(`You are a background analysis model for an AI coding interviewer.
Your role is to observe the candidate's progress and produce structured reflections.
You do NOT talk to the candidate. You produce analysis for the conversation model.`);

  sections.push(`OUTPUT FORMAT:
Respond with a JSON array of reflection objects. Each object has:
- "type": one of "observation", "suggestion", "next_move", "scoring_update", "score"
- "content": your analysis text (1-2 sentences)
- "priority": 1-10 (10 = most urgent)
- "nextMove": (only for type "next_move") an object with:
  - "action": one of "reveal_next_part", "give_hint", "ask_complexity", "wrap_up", "continue"
  - "targetPart": (optional) part number to advance to
  - "condition": one of "immediate", "after_response", "when_stuck"
- "scores": (only for type "score") an object with numeric 1-4 values:
  - "communication": 1=silent/confused, 2=explains when asked, 3=narrates approach, 4=drives conversation
  - "problemSolving": 1=no progress, 2=brute force with hints, 3=optimal with 1-2 hints, 4=optimal independently
  - "technical": 1=can't code it, 2=works with bugs, 3=clean+correct, 4=elegant+idiomatic
  - "testing": 1=no testing awareness, 2=happy path only, 3=considers edge cases, 4=systematic+complexity analysis

IMPORTANT: Always include exactly one "score" type reflection in every analysis. This provides live scoring feedback to the candidate.

Example:
[
  {"type": "observation", "content": "Candidate is implementing brute force O(n^2). Has not considered hash map.", "priority": 5},
  {"type": "score", "content": "Good communication but still on brute force approach.", "priority": 3, "scores": {"communication": 3, "problemSolving": 2, "technical": 2, "testing": 1}},
  {"type": "next_move", "content": "All tests passing and candidate explained complexity. Ready for part 2.", "priority": 9, "nextMove": {"action": "reveal_next_part", "targetPart": 2, "condition": "immediate"}}
]`);

  sections.push(`PROBLEM: "${ctx.question.title}" (${ctx.question.difficulty})
Part ${String(ctx.currentPart.partNumber)} of ${String(ctx.totalParts)}

Expected approach: ${ctx.currentPart.expectedApproach}
Expected complexity: Time ${ctx.currentPart.expectedComplexity.time}, Space ${ctx.currentPart.expectedComplexity.space}

Internal notes: ${ctx.currentPart.internalNotes}`);

  if (ctx.currentPart.transitionCriteria) {
    const tc = ctx.currentPart.transitionCriteria;
    sections.push(`TRANSITION CRITERIA for next part:
- Minimum approach quality: ${tc.minApproachQuality}
- Must explain complexity: ${String(tc.mustExplainComplexity)}
- Transition framing: "${tc.transitionPrompt}"`);
  }

  sections.push(`SESSION STATE:
Timer: ${ctx.timerDisplay} (phase: ${ctx.timerPhase})
Hints given: ${String(ctx.hintsGiven)}
Tests run: ${String(ctx.testsRun)}`);

  if (ctx.codeSnapshot !== null) {
    sections.push(`CURRENT CODE:
\`\`\`
${ctx.codeSnapshot}
\`\`\``);
  }

  sections.push(`ANALYSIS GUIDELINES:
- Focus on what the candidate knows vs doesn't know
- Identify if they're stuck (2+ turns with no meaningful progress)
- Track whether transition criteria are met
- Note code quality issues (bugs, edge cases, complexity)
- Suggest when to give hints and at what level
- When time is running out (past_75 or later), prioritize wrap-up
- Produce 1-3 reflections per analysis. Quality over quantity.`);

  return sections.join("\n\n---\n\n");
}

export function buildReflectionUserPrompt(
  entries: TranscriptEntry[],
): string {
  if (entries.length === 0) {
    return "No transcript entries yet. The session just started.";
  }

  const lines = entries.map((e) => {
    const role = e.role === "interviewer" ? "AI" : e.role.toUpperCase();
    return `[${role}] ${e.content}`;
  });

  return `Recent transcript:\n${lines.join("\n")}`;
}
