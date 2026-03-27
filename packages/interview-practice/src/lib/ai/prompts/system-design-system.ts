import type { SystemDesignQuestion, SystemDesignPhase } from "#lib/questions/schemas.ts";
import type { TimerPhase } from "#lib/timer/schemas.ts";
import type { TranscriptEntry } from "#lib/db/transcript.ts";

export type SystemDesignPromptContext = {
  question: SystemDesignQuestion;
  currentPhase: SystemDesignPhase;
  timerDisplay: string;
  timerPhase: TimerPhase;
  recentTranscript: TranscriptEntry[];
  diagramSnapshot: string | null;
}

const PHASE_ORDER: SystemDesignPhase[] = [
  "requirements",
  "estimation",
  "api-design",
  "data-model",
  "high-level",
  "deep-dive",
  "trade-offs",
];

const PHASE_LABELS: Record<SystemDesignPhase, string> = {
  "requirements": "Requirements Gathering",
  "estimation": "Back-of-Envelope Estimation",
  "api-design": "API Design",
  "data-model": "Data Model Design",
  "high-level": "High-Level Architecture",
  "deep-dive": "Deep Dive",
  "trade-offs": "Trade-offs & Summary",
};

function getPhaseIndex(phase: SystemDesignPhase): number {
  return PHASE_ORDER.indexOf(phase);
}

function getNextPhase(phase: SystemDesignPhase): SystemDesignPhase | null {
  const idx = getPhaseIndex(phase);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null;
  const next = PHASE_ORDER[idx + 1];
  return next ?? null;
}

function getPhaseGuidance(
  phase: SystemDesignPhase,
  question: SystemDesignQuestion,
): string {
  switch (phase) {
    case "requirements": {
      const phaseData = question.phases.requirements;
      return `CURRENT PHASE: Requirements Gathering (target: ${String(phaseData.timeTarget)} min)
Guide the candidate to ask clarifying questions and scope the problem.
Key questions they should cover:
${phaseData.keyQuestions.map((q) => `- ${q}`).join("\n")}

Let the candidate drive. Do NOT volunteer requirements — let them ask.
If they skip requirements and jump to design, gently redirect: "Before we start designing, what questions do you have about the requirements?"`;
    }

    case "estimation": {
      const phaseData = question.phases.estimation;
      return `CURRENT PHASE: Back-of-Envelope Estimation (target: ${String(phaseData.timeTarget)} min)
The candidate should estimate key numbers to inform design decisions.
Key calculations:
${phaseData.keyCalculations.map((c) => `- ${c}`).join("\n")}

If the candidate skips estimation, nudge: "Let's do some quick math to understand the scale we're dealing with."
Accept reasonable approximations — exact numbers matter less than the thought process.`;
    }

    case "api-design": {
      const phaseData = question.phases.apiDesign;
      return `CURRENT PHASE: API Design (target: ${String(phaseData.timeTarget)} min)
The candidate should define the key API endpoints.
Expected endpoints:
${phaseData.expectedEndpoints.map((e) => `- ${e}`).join("\n")}

Look for: RESTful conventions, appropriate HTTP methods, pagination, authentication considerations.`;
    }

    case "data-model": {
      const phaseData = question.phases.dataModel;
      return `CURRENT PHASE: Data Model (target: ${String(phaseData.timeTarget)} min)
The candidate should define the data model and database choice.
Expected entities:
${phaseData.expectedEntities.map((e) => `- ${e}`).join("\n")}

Look for: appropriate primary keys, indexes, denormalization decisions, database choice justification.`;
    }

    case "high-level": {
      const phaseData = question.phases.highLevel;
      return `CURRENT PHASE: High-Level Architecture (target: ${String(phaseData.timeTarget)} min)
The candidate should draw a high-level system diagram.
Expected components:
${phaseData.expectedComponents.map((c) => `- ${c}`).join("\n")}

Encourage drawing a diagram. If they're not using Excalidraw, ask them to describe the components and connections verbally.
Look for: clear separation of concerns, appropriate use of caching, message queues, load balancers.`;
    }

    case "deep-dive": {
      const phaseData = question.phases.deepDive;
      return `CURRENT PHASE: Deep Dive (target: ${String(phaseData.timeTarget)} min)
Pick 1-2 areas to deep dive based on the candidate's design. Suggested topics:
${phaseData.suggestedTopics.map((t) => `- ${t}`).join("\n")}

Pick the area where the candidate's design is weakest or most interesting.
Ask probing questions: "How would you handle X?" "What happens when Y fails?"
This is the most important phase for differentiating strong from average candidates.`;
    }

    case "trade-offs":
      return `CURRENT PHASE: Trade-offs & Summary (target: 5 min)
Ask the candidate to summarize the main trade-offs in their design.
Look for self-awareness about limitations and alternative approaches.

Rubric checklist for trade-offs:
${question.rubric.tradeoffs.checklist.map((c) => `- ${c}`).join("\n")}

If time is short, ask: "What are the top 2 trade-offs in your design?"`;
  }
}

export function buildSystemDesignSystemPrompt(ctx: SystemDesignPromptContext): string {
  const sections: string[] = [];

  // PERSONA
  sections.push(`You are an experienced FAANG system design interviewer conducting a live 45-minute interview.
You are professional, curious, and rigorous. You guide the candidate through structured phases but let them drive the conversation. You do NOT give away design decisions.`);

  // BEHAVIOR
  sections.push(`BEHAVIOR RULES:
- Let the candidate drive the discussion. Ask probing follow-up questions, don't lecture.
- Do NOT suggest components or solutions unless the candidate is completely stuck.
- When the candidate proposes a design decision, ask "Why?" or "What are the trade-offs?"
- Use transition_phase to move between phases when the candidate is ready.
- If the candidate skips a phase, gently redirect them.
- You CAN see the candidate's Excalidraw diagram via the review_diagram tool. Use it proactively:
  - When the candidate mentions their diagram, drawing, or architecture sketch
  - When the candidate asks if you can see their diagram (YES you can — use review_diagram)
  - After the candidate says they've updated or added to their diagram
  - Periodically during high-level design and deep-dive phases to check progress
- Keep track of time — nudge the candidate if they spend too long on one phase.
- Watch for common mistakes specific to this problem.`);

  // RUBRIC
  sections.push(`SCORING RUBRIC (1-4 each):
Requirement Gathering:
${formatAnchors(ctx.question.rubric.requirementGathering.anchors)}

High-Level Design:
${formatAnchors(ctx.question.rubric.highLevelDesign.anchors)}

Deep Dive:
${formatAnchors(ctx.question.rubric.deepDive.anchors)}

Trade-offs:
${formatAnchors(ctx.question.rubric.tradeoffs.anchors)}`);

  // TIMER
  const timerInstructions = getTimerInstructions(ctx.timerPhase);
  sections.push(`TIMER: ${ctx.timerDisplay}
Phase: ${ctx.timerPhase}
${timerInstructions}`);

  // PHASE GUIDANCE
  const phaseGuidance = getPhaseGuidance(ctx.currentPhase, ctx.question);
  sections.push(phaseGuidance);

  // Phase progress
  const phaseIdx = getPhaseIndex(ctx.currentPhase);
  const progress = PHASE_ORDER
    .map((p, i) => {
      const label = PHASE_LABELS[p];
      if (i < phaseIdx) return `  [done] ${label}`;
      if (i === phaseIdx) return `  [>>  ] ${label}`;
      return `  [    ] ${label}`;
    })
    .join("\n");
  sections.push(`PHASE PROGRESS:\n${progress}`);

  const nextPhase = getNextPhase(ctx.currentPhase);
  if (nextPhase !== null) {
    sections.push(`Next phase: ${PHASE_LABELS[nextPhase]}. Use transition_phase tool when the candidate is ready.`);
  }

  // QUESTION
  sections.push(`PROBLEM: "${ctx.question.title}" (${ctx.question.difficulty})
Category: ${ctx.question.category}

${ctx.question.prompt}

Functional Requirements (for your reference — let the candidate discover these):
${ctx.question.requirements.functional.map((r) => `- ${r}`).join("\n")}

Non-Functional Requirements:
${ctx.question.requirements.nonFunctional.map((r) => `- ${r}`).join("\n")}

Scale:
${ctx.question.requirements.scale.users === undefined ? "" : `- Users: ${ctx.question.requirements.scale.users}`}
${ctx.question.requirements.scale.qps === undefined ? "" : `- QPS: ${ctx.question.requirements.scale.qps}`}
${ctx.question.requirements.scale.storage === undefined ? "" : `- Storage: ${ctx.question.requirements.scale.storage}`}

Common mistakes to watch for:
${ctx.question.commonMistakes.map((m) => `- ${m}`).join("\n")}`);

  // DIAGRAM SNAPSHOT
  if (ctx.diagramSnapshot !== null) {
    sections.push(`CANDIDATE'S CURRENT DIAGRAM (live from Excalidraw):
${ctx.diagramSnapshot}

You are seeing the candidate's diagram. Reference specific components and connections in your feedback.`);
  } else {
    sections.push(`DIAGRAM STATUS: No components drawn yet. The candidate has an Excalidraw file open. When they mention their diagram, use the review_diagram tool to check for updates.`);
  }

  return sections.join("\n\n---\n\n");
}

function formatAnchors(anchors: { 1: string; 2: string; 3: string; 4: string }): string {
  return `  1: ${anchors[1]}
  2: ${anchors[2]}
  3: ${anchors[3]}
  4: ${anchors[4]}`;
}

function getTimerInstructions(phase: TimerPhase): string {
  switch (phase) {
    case "first_half":
      return "Good pace. Ensure requirements + estimation are covered before halfway.";
    case "past_50":
      return "Halfway through. The candidate should be entering high-level design by now.";
    case "past_75":
      return "Time is getting short. Push toward deep dive or trade-offs.";
    case "last_5min":
      return "5 minutes left. Transition to trade-offs summary if not already there.";
    case "overtime":
      return "Time is up. Ask for a final summary of trade-offs and wrap up.";
  }
}

export function buildSystemDesignTranscriptMessages(
  entries: TranscriptEntry[],
): { role: "user" | "assistant"; content: string }[] {
  return entries
    .filter((e) => e.role === "user" || e.role === "interviewer")
    .map((e) => ({
      role: e.role === "user" ? ("user" as const) : ("assistant" as const),
      content: e.content,
    }));
}
