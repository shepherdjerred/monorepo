import type { LeetcodeQuestion, QuestionPart } from "#lib/questions/schemas.ts";
import type { TimerPhase } from "#lib/timer/schemas.ts";
import type { TranscriptEntry } from "#lib/db/transcript.ts";
import type { Reflection } from "./reflection-queue.ts";

export type TokenBudgets = {
  persona: number;
  timerAndQuestion: number;
  reflections: number;
  transcript: number;
  codeSnapshot: number;
};

export const DEFAULT_BUDGETS: TokenBudgets = {
  persona: 800,
  timerAndQuestion: 600,
  reflections: 400,
  transcript: 2000,
  codeSnapshot: 2000,
};

export type ContextParts = {
  persona: string;
  timerAndQuestion: string;
  reflections: string;
  transcript: TranscriptEntry[];
  codeSnapshot: string | null;
};

export type BuiltContext = {
  systemPrompt: string;
  transcriptEntries: TranscriptEntry[];
};

// Rough token estimation: ~4 chars per token for English text
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function truncateToTokenBudget(text: string, budget: number): string {
  const maxChars = budget * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n[...truncated]";
}

export function truncateTranscript(
  entries: TranscriptEntry[],
  budget: number,
): TranscriptEntry[] {
  const maxChars = budget * CHARS_PER_TOKEN;
  let totalChars = 0;
  const result: TranscriptEntry[] = [];

  // Take from the end (most recent) and work backwards
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry === undefined) continue;
    const entryChars = entry.content.length + entry.role.length + 4; // overhead for formatting
    if (totalChars + entryChars > maxChars && result.length > 0) break;
    totalChars += entryChars;
    result.unshift(entry);
  }

  return result;
}

export function formatReflectionsForContext(
  reflections: Reflection[],
  budget: number,
): string {
  if (reflections.length === 0) return "";

  const lines = reflections.map(
    (r) => `[${r.type}] (p${String(r.priority)}) ${r.content}`,
  );
  const text = "REFLECTIONS FROM ANALYSIS:\n" + lines.join("\n");
  return truncateToTokenBudget(text, budget);
}

export function truncateCodeSnapshot(code: string, budget: number): string {
  const maxChars = budget * CHARS_PER_TOKEN;
  if (code.length <= maxChars) return code;

  // Keep the first N lines (function signature and main logic are most important)
  const lines = code.split("\n");
  const result: string[] = [];
  let totalChars = 0;

  for (const line of lines) {
    if (totalChars + line.length + 1 > maxChars && result.length > 0) break;
    totalChars += line.length + 1;
    result.push(line);
  }

  if (result.length < lines.length) {
    result.push("[...remaining code truncated]");
  }

  return result.join("\n");
}

export type BuildContextOptions = {
  question: LeetcodeQuestion;
  currentPart: QuestionPart;
  totalParts: number;
  timerDisplay: string;
  timerPhase: TimerPhase;
  hintsGiven: number;
  testsRun: number;
  recentTranscript: TranscriptEntry[];
  codeSnapshot: string | null;
  reflections: Reflection[];
  personaPrompt: string;
  budgets?: TokenBudgets;
};

export function buildContext(options: BuildContextOptions): BuiltContext {
  const budgets = options.budgets ?? DEFAULT_BUDGETS;

  const sections: string[] = [];

  // PERSONA (truncated to budget)
  sections.push(truncateToTokenBudget(options.personaPrompt, budgets.persona));

  // TIMER + QUESTION
  const timerAndQuestion = buildTimerAndQuestion({
    question: options.question,
    currentPart: options.currentPart,
    totalParts: options.totalParts,
    timerDisplay: options.timerDisplay,
    timerPhase: options.timerPhase,
    hintsGiven: options.hintsGiven,
    testsRun: options.testsRun,
  });
  sections.push(
    truncateToTokenBudget(timerAndQuestion, budgets.timerAndQuestion),
  );

  // REFLECTIONS
  const reflectionsText = formatReflectionsForContext(
    options.reflections,
    budgets.reflections,
  );
  if (reflectionsText !== "") {
    sections.push(reflectionsText);
  }

  // CODE SNAPSHOT
  if (options.codeSnapshot !== null) {
    const truncatedCode = truncateCodeSnapshot(
      options.codeSnapshot,
      budgets.codeSnapshot,
    );
    sections.push(
      `CANDIDATE'S CURRENT CODE:\n\`\`\`\n${truncatedCode}\n\`\`\``,
    );
  }

  // TRANSCRIPT (truncated to budget, returned separately for message construction)
  const truncatedTranscript = truncateTranscript(
    options.recentTranscript,
    budgets.transcript,
  );

  return {
    systemPrompt: sections.join("\n\n---\n\n"),
    transcriptEntries: truncatedTranscript,
  };
}

function buildTimerAndQuestion(opts: {
  question: LeetcodeQuestion;
  currentPart: QuestionPart;
  totalParts: number;
  timerDisplay: string;
  timerPhase: TimerPhase;
  hintsGiven: number;
  testsRun: number;
}): string {
  const lines = [
    `TIMER: ${opts.timerDisplay} (phase: ${opts.timerPhase})`,
    "",
    `PROBLEM: "${opts.question.title}" (${opts.question.difficulty})`,
    `Part ${String(opts.currentPart.partNumber)} of ${String(opts.totalParts)}`,
    "",
    opts.currentPart.prompt,
    "",
    `Expected approach: ${opts.currentPart.expectedApproach}`,
    `Expected complexity: Time ${opts.currentPart.expectedComplexity.time}, Space ${opts.currentPart.expectedComplexity.space}`,
    `Internal notes: ${opts.currentPart.internalNotes}`,
    "",
    `Hints given: ${String(opts.hintsGiven)}`,
    `Tests run: ${String(opts.testsRun)}`,
  ];

  if (opts.currentPart.transitionCriteria) {
    const tc = opts.currentPart.transitionCriteria;
    lines.push("");
    lines.push(`TRANSITION TO NEXT PART when:`);
    lines.push(`- Approach quality >= ${tc.minApproachQuality}`);
    lines.push(
      tc.mustExplainComplexity
        ? "- Candidate has explained time/space complexity"
        : "- Complexity explanation not required",
    );
    lines.push(`Frame transition as: "${tc.transitionPrompt}"`);
  }

  return lines.join("\n");
}
