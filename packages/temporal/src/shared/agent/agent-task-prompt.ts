import { agentTaskChecksV2, type AgentTaskInput } from "./agent-task.ts";
import type { AgentTaskResultPayloadV2 } from "./agent-task.ts";
import type { ReportEvidenceReceiptV1 } from "#shared/reports/report.ts";

export type AgentTaskPromptPhase =
  | { kind: "single" }
  | { kind: "investigation" }
  | {
      kind: "finalization";
      evidence: readonly ReportEvidenceReceiptV1[];
      preliminary: AgentTaskResultPayloadV2;
    };
export const SINGLE_AGENT_TASK_PROMPT_PHASE = { kind: "single" } as const;

function phaseLines(phase: AgentTaskPromptPhase): string[] {
  if (phase.kind === "single") return [];
  if (phase.kind === "investigation") {
    return [
      "Investigation phase:",
      "- Use read-only tools for additional research and interpretation.",
      "- Independently declared collectors run after this phase; provider tool calls cannot substitute for them.",
      "- Return a preliminary structured assessment after the investigation.",
      "- A separate finalization phase will receive the captured receipt catalog and validate every reference.",
      "",
    ];
  }
  return [
    "Finalization phase:",
    "- Do not invoke tools or gather new evidence.",
    "- Use only the captured evidence catalog below.",
    "- Every evidenceReceiptIds entry must exactly match an id in that catalog.",
    "- A failed receipt cannot support a passed check.",
    "",
    "Captured evidence catalog:",
    JSON.stringify(phase.evidence, undefined, 2),
    "",
    "Preliminary investigation assessment:",
    JSON.stringify(phase.preliminary, undefined, 2),
    "",
  ];
}

export function reportOnlyPrompt(
  input: AgentTaskInput,
  workdir: string,
  phase: AgentTaskPromptPhase = SINGLE_AGENT_TASK_PROMPT_PHASE,
): string {
  const runtimeLines =
    input.agentTimeoutMinutes === undefined
      ? []
      : [
          `Runtime budget: ${String(input.agentTimeoutMinutes)} minutes.`,
          "- Keep every shell command narrowly scoped and time-bounded; use the `timeout` command when available.",
          "- If a command is slow or would exceed the budget, stop that section, mark it Skipped or Failed, and return the partial report.",
          "",
        ];
  const sourceLines =
    input.source === undefined
      ? []
      : [
          "Source context:",
          input.source.docPath === undefined
            ? undefined
            : `- docPath: ${input.source.docPath}`,
          input.source.url === undefined
            ? undefined
            : `- url: ${input.source.url}`,
          input.source.note === undefined
            ? undefined
            : `- note: ${input.source.note}`,
          "",
        ].filter((line) => line !== undefined);
  const evidenceLines =
    input.contractVersion === 2
      ? [
          "Declared checks:",
          ...agentTaskChecksV2(input).map(
            (check) =>
              `- ${check.id} (${check.required ? "required" : "optional"}): ${check.label}. Evidence requirement: ${check.evidenceRequirement}. Independent collectors: ${JSON.stringify(check.evidenceCollectors ?? [])}`,
          ),
          "- Report every declared check exactly once.",
          "- Final evidenceReceiptIds must include every independently collected receipt id declared for that check.",
          "- Provider tool-use receipts may add context but cannot establish declared check coverage.",
          "- Never mark a check passed from memory, assumptions, prose, or a failed tool result.",
          "- Do not choose a report status or email subject; the reporter derives them from validated checks and findings.",
          "- Use retirementRecommendation for a human decision; never pause or cancel the schedule.",
          "",
        ]
      : [];

  return [
    "You are running as a delayed Temporal agent task.",
    "",
    "Hard constraints:",
    "- This task is report-only.",
    "- Do not edit files, commit, push, open pull requests, open issues, or mutate live systems.",
    "- You may inspect the checked-out repository and query read-only operational tools when the prompt requires current state.",
    "- Revalidate the source context first; if the task is already resolved, report that clearly.",
    ...(input.contractVersion === 2
      ? []
      : [
          "- Legacy v1 only: cancelCron may be returned for replay compatibility; new runs do not act on it.",
        ]),
    "- If one future report-only follow-up is needed, set followUp with either runAt or cron.",
    "- A v2 follow-up inherits the current declared checks and collectors; do not attempt to redefine them.",
    "- Return only JSON matching the provided schema.",
    "",
    ...runtimeLines,
    ...evidenceLines,
    ...phaseLines(phase),
    `Task title: ${input.title}`,
    `Repository workdir: ${workdir}`,
    "",
    ...sourceLines,
    "User prompt:",
    input.prompt,
  ].join("\n");
}
