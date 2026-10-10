import type { RunReport, TaskReport, Usage } from "#evals/lib/types.ts";

const thousands = (value: number): string => `${(value / 1000).toFixed(0)}k`;

function usageCell(usage: Usage | null): string {
  if (usage === null) {
    return "—";
  }
  const cost =
    usage.costUsd === undefined ? "" : ` · $${usage.costUsd.toFixed(2)}`;
  return `${thousands(usage.inputTokens)} in (${thousands(usage.cachedInputTokens)} cached) / ${thousands(usage.outputTokens)} out${cost}`;
}

function score(task: TaskReport): string {
  const passed = task.checks.filter((check) => check.pass).length;
  return `${String(passed)}/${String(task.checks.length)}`;
}

function judgeCell(task: TaskReport): string {
  const judge = task.judge;
  if (judge === null) return "—";
  const outcome =
    judge.winner === "tie"
      ? "tie"
      : judge.winner === "agent"
        ? "agent wins"
        : `${judge.reference} wins`;
  return `${outcome} (${judge.confidence.toFixed(2)}${judge.agreed ? "" : ", disagreed"})`;
}

function taskSection(task: TaskReport): string {
  const checks = task.checks.map(
    (check) => `- ${check.pass ? "✅" : "❌"} ${check.name} — ${check.detail}`,
  );
  const artifacts = task.artifacts.map((artifact) => `- ${artifact}`);
  const notes = task.notes.map((note) => `- ${note}`);
  const lastMessage = task.lastMessage.trim().slice(0, 1200);
  return [
    `## ${task.id} — ${task.title}: ${task.status}`,
    "",
    `Agent exit ${String(task.agentExitCode)}, ${String(task.seconds)} s, ${usageCell(task.usage)}. Files: \`${task.taskDir}\``,
    "",
    "### Checks",
    ...(checks.length > 0 ? checks : ["- (none)"]),
    ...(artifacts.length > 0 ? ["", "### Artifacts", ...artifacts] : []),
    ...(notes.length > 0 ? ["", "### Notes", ...notes] : []),
    ...(lastMessage.length > 0
      ? ["", "### Agent summary", "", lastMessage.replaceAll(/^/gmu, "> ")]
      : []),
  ].join("\n");
}

export function renderReport(report: RunReport): string {
  const rows = report.tasks.map(
    (task) =>
      `| ${task.id} | ${task.title} | ${task.status} | ${score(task)} | ${judgeCell(task)} | ${String(task.seconds)} s | ${usageCell(task.usage)} |`,
  );
  const passed = report.tasks.filter((task) => task.status === "passed").length;
  return [
    `# Minecraft harness eval ${report.runId}`,
    "",
    `Agent **${report.agent}**${report.model === null ? "" : ` (${report.model})`} on \`${report.head.slice(0, 10)}\`, started ${report.startedAt}. **${String(passed)}/${String(report.tasks.length)} passed.**`,
    "",
    "| Task | What | Status | Checks | Judge vs library | Time | Tokens |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    ...report.tasks.map((task) => taskSection(task)),
    "",
  ].join("\n");
}
