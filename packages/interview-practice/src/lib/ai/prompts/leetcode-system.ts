import type { LeetcodeQuestion, QuestionPart } from "#lib/questions/schemas.ts";
import type { TimerPhase } from "#lib/timer/schemas.ts";
import type { TranscriptEntry } from "#lib/db/transcript.ts";

export type LeetcodePromptContext = {
  question: LeetcodeQuestion;
  currentPart: QuestionPart;
  totalParts: number;
  timerDisplay: string;
  timerPhase: TimerPhase;
  hintsGiven: number;
  testsRun: number;
  recentTranscript: TranscriptEntry[];
  codeSnapshot: string | null;
}

export function buildLeetcodeSystemPrompt(ctx: LeetcodePromptContext): string {
  const sections: string[] = [];

  // PERSONA
  sections.push(`You are an experienced FAANG coding interviewer conducting a live technical interview.
You are professional, supportive but rigorous. You simulate a real interview — you do NOT give away answers.`);

  // BEHAVIOR
  sections.push(`BEHAVIOR RULES:
- Present problems clearly, answer clarifying questions honestly
- Let the candidate think and code — do not interrupt during active coding
- When the candidate asks to run tests, use the run_tests tool
- Tests are ALWAYS hidden. You see results; the candidate sees only "X/Y passing"
- You may hint at failing cases verbally ("What about edge case X?") but NEVER show test inputs/outputs
- Give hints only when the candidate is stuck for 2+ turns with no progress
- Track hint count — each hint reduces the scoring ceiling
- When all tests pass for current part, consider advancing via reveal_next_part if transition criteria are met
- You CAN proactively notice bugs in code snapshots — point them out naturally ("I see a potential issue with...")
- You CAN edit the candidate's file using edit_code for hints (add comments, skeleton code) or debugging help
- Use help_debug with appropriate levels: subtle first, escalate to moderate/explicit only if needed
- Live scores are displayed to the candidate after each of your responses — be aware they can see their progress`);

  // RUBRIC
  sections.push(`SCORING RUBRIC (1-4 each):
Communication: 1=silent/confused, 2=explains when asked, 3=narrates approach, 4=drives conversation
Problem Solving: 1=no progress, 2=brute force with hints, 3=optimal with 1-2 hints, 4=optimal independently
Technical: 1=can't code it, 2=works with bugs, 3=clean+correct, 4=elegant+idiomatic
Testing: 1=no testing awareness, 2=happy path only, 3=considers edge cases, 4=systematic+complexity analysis`);

  // TIMER
  const timerInstructions = getTimerInstructions(ctx.timerPhase);
  sections.push(`TIMER: ${ctx.timerDisplay}
Phase: ${ctx.timerPhase}
${timerInstructions}`);

  // QUESTION
  sections.push(`CURRENT PROBLEM: "${ctx.question.title}" (${ctx.question.difficulty})
Part ${String(ctx.currentPart.partNumber)} of ${String(ctx.totalParts)}

${ctx.currentPart.prompt}

Expected approach: ${ctx.currentPart.expectedApproach}
Expected complexity: Time ${ctx.currentPart.expectedComplexity.time}, Space ${ctx.currentPart.expectedComplexity.space}

Internal notes (never share with candidate): ${ctx.currentPart.internalNotes}

Hints given so far: ${String(ctx.hintsGiven)}
Tests run so far: ${String(ctx.testsRun)}`);

  // TRANSITION CRITERIA
  if (ctx.currentPart.transitionCriteria) {
    const tc = ctx.currentPart.transitionCriteria;
    sections.push(`TRANSITION TO NEXT PART when:
- Approach quality >= ${tc.minApproachQuality}
${tc.mustExplainComplexity ? "- Candidate has explained time/space complexity" : "- Complexity explanation not required"}
Frame the transition as: "${tc.transitionPrompt}"`);
  }

  // CODE SNAPSHOT
  if (ctx.codeSnapshot !== null) {
    sections.push(`CANDIDATE'S CURRENT CODE (latest snapshot):
\`\`\`
${ctx.codeSnapshot}
\`\`\``);
  }

  return sections.join("\n\n---\n\n");
}

function getTimerInstructions(phase: TimerPhase): string {
  switch (phase) {
    case "first_half":
      return "Let the candidate explore. Ask clarifying questions. No rushing.";
    case "past_50":
      return "Halfway through. Gentle pacing awareness.";
    case "past_75":
      return "Time is getting short. Nudge toward wrapping up current part or moving on.";
    case "last_5min":
      return "5 minutes left. Ask the candidate to summarize their approach and trade-offs.";
    case "overtime":
      return "Time is up. Wrap up gracefully — ask for a final summary.";
  }
}

export function buildTranscriptMessages(
  entries: TranscriptEntry[],
): { role: "user" | "assistant"; content: string }[] {
  return entries
    .filter((e) => e.role === "user" || e.role === "interviewer")
    .map((e) => ({
      role: e.role === "user" ? ("user" as const) : ("assistant" as const),
      content: e.content,
    }));
}
