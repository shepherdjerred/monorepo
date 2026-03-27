import type { RealtimeSessionConfig } from "./realtime.ts";
import type { LeetcodeQuestion, QuestionPart } from "#lib/questions/schemas.ts";
import type { ToolDefinition } from "#lib/ai/client.ts";

export type VoiceSessionContext = {
  model: string;
  voice: string;
  question: LeetcodeQuestion;
  currentPart: QuestionPart;
  totalParts: number;
  timerDisplay: string;
  hintsGiven: number;
  testsRun: number;
  tools: ToolDefinition[];
  reflections?: string | undefined;
  codeSnapshot?: string | undefined;
};

export function buildRealtimeSessionConfig(
  ctx: VoiceSessionContext,
): RealtimeSessionConfig {
  const instructions = buildVoiceSystemPrompt(ctx);

  return {
    model: ctx.model,
    modalities: ["text", "audio"],
    voice: ctx.voice,
    instructions,
    tools: ctx.tools.map((t) => ({
      type: "function" as const,
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        ...t.inputSchema,
      },
    })),
    input_audio_transcription: {
      model: "gpt-4o-mini-transcribe",
    },
    turn_detection: {
      type: "server_vad",
      threshold: 0.5,
      silence_duration_ms: 500,
      prefix_padding_ms: 300,
    },
  };
}

function buildVoiceSystemPrompt(ctx: VoiceSessionContext): string {
  const sections: string[] = [];

  sections.push(
    `You are an experienced FAANG coding interviewer conducting a live voice technical interview.
Be professional, supportive but rigorous. Simulate a real interview -- do NOT give away answers.
Keep responses concise and conversational (this is voice, not text).`,
  );

  sections.push(
    `BEHAVIOR:
- Present problems clearly, answer clarifying questions honestly
- Let the candidate think -- pause naturally
- Tests are ALWAYS hidden. You see results; the candidate hears only pass/fail counts
- Give hints only when the candidate is stuck for 2+ exchanges with no progress
- When all tests pass, consider advancing via reveal_next_part`,
  );

  sections.push(
    `SCORING (1-4): Communication, Problem Solving, Technical, Testing
Assess continuously but only share scores when asked or at session end.`,
  );

  sections.push(
    `TIMER: ${ctx.timerDisplay}
Hints given: ${String(ctx.hintsGiven)}
Tests run: ${String(ctx.testsRun)}`,
  );

  sections.push(
    `PROBLEM: "${ctx.question.title}" (${ctx.question.difficulty})
Part ${String(ctx.currentPart.partNumber)} of ${String(ctx.totalParts)}

${ctx.currentPart.prompt}

Expected approach: ${ctx.currentPart.expectedApproach}
Expected complexity: Time ${ctx.currentPart.expectedComplexity.time}, Space ${ctx.currentPart.expectedComplexity.space}

Internal notes (never share): ${ctx.currentPart.internalNotes}`,
  );

  if (ctx.codeSnapshot !== undefined) {
    sections.push(
      `CANDIDATE'S CURRENT CODE:\n\`\`\`\n${ctx.codeSnapshot}\n\`\`\``,
    );
  }

  if (ctx.reflections !== undefined) {
    sections.push(`REFLECTIONS:\n${ctx.reflections}`);
  }

  return sections.join("\n\n");
}
