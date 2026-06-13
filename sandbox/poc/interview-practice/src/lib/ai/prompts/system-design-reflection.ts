import type {
  SystemDesignQuestion,
  SystemDesignPhase,
} from "#lib/questions/schemas.ts";
import type { TranscriptEntry } from "#lib/db/transcript.ts";

export type SystemDesignReflectionContext = {
  question: SystemDesignQuestion;
  currentPhase: SystemDesignPhase;
  recentTranscript: TranscriptEntry[];
  diagramSnapshot: string | null;
};

export function buildSystemDesignReflectionPrompt(
  ctx: SystemDesignReflectionContext,
): string {
  const sections: string[] = [];

  sections.push(`You are a senior interviewer reflection model analyzing a system design interview in progress.

Your role is to produce insights that help the conversation model be a better interviewer. You do NOT talk to the candidate directly.

Output structured JSON with your analysis.`);

  sections.push(`PROBLEM: "${ctx.question.title}" (${ctx.question.difficulty})
Category: ${ctx.question.category}
Current Phase: ${ctx.currentPhase}

${ctx.question.prompt}`);

  sections.push(`RUBRIC CHECKLIST FOR CURRENT EVALUATION:
Requirement Gathering: ${ctx.question.rubric.requirementGathering.checklist.join(", ")}
High-Level Design: ${ctx.question.rubric.highLevelDesign.checklist.join(", ")}
Deep Dive: ${ctx.question.rubric.deepDive.checklist.join(", ")}
Trade-offs: ${ctx.question.rubric.tradeoffs.checklist.join(", ")}`);

  sections.push(`Common mistakes for this problem:
${ctx.question.commonMistakes.map((m) => `- ${m}`).join("\n")}`);

  if (ctx.diagramSnapshot !== null) {
    sections.push(`CURRENT DIAGRAM:
${ctx.diagramSnapshot}`);
  }

  sections.push(`RECENT TRANSCRIPT:
${ctx.recentTranscript.map((e) => `[${e.role}] ${e.content}`).join("\n")}`);

  sections.push(`Analyze the candidate's performance and output JSON:
{
  "phase_assessment": "how well is the candidate handling the current phase?",
  "should_transition": boolean,  // should we move to the next phase?
  "transition_reason": "why or why not",
  "candidate_strengths": ["what the candidate is doing well"],
  "candidate_gaps": ["what the candidate is missing or doing poorly"],
  "suggested_questions": ["probing questions the interviewer should ask"],
  "common_mistake_detected": "any common mistake the candidate is making, or null",
  "current_scores": {
    "requirementGathering": number | null,
    "highLevelDesign": number | null,
    "deepDive": number | null,
    "tradeoffs": number | null
  },
  "next_move": {
    "type": "continue" | "transition_phase" | "probe_deeper" | "redirect",
    "action": "specific action recommendation",
    "target_phase": "phase to transition to, if applicable"
  }
}`);

  return sections.join("\n\n---\n\n");
}
