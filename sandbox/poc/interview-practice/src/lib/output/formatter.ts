import type { TestRunResult } from "#lib/testing/runner.ts";

export function formatInterviewerMessage(text: string): string {
  return `\n\u001B[36mInterviewer:\u001B[0m ${text}\n`;
}

export function formatTestSummary(result: TestRunResult): string {
  if (result.compileError !== null) {
    return `\n\u001B[31mCompilation Error\u001B[0m\n${result.compileError}\n`;
  }

  const color = result.failed === 0 ? "\u001B[32m" : "\u001B[33m";
  return `\n${color}Tests: ${String(result.passed)}/${String(result.total)} passing\u001B[0m\n`;
}

export function formatTimerWarning(warning: string): string {
  return `\n\u001B[33m⏱ ${warning}\u001B[0m\n`;
}

export function formatTimerDisplay(display: string): string {
  return `\n\u001B[90m${display}\u001B[0m\n`;
}

export function formatScore(scores: {
  communication: number;
  problemSolving: number;
  technical: number;
  testing: number;
  feedback: string;
}): string {
  return `
\u001B[1mCurrent Assessment:\u001B[0m
  Communication:  ${"★".repeat(scores.communication)}${"☆".repeat(4 - scores.communication)} (${String(scores.communication)}/4)
  Problem Solving: ${"★".repeat(scores.problemSolving)}${"☆".repeat(4 - scores.problemSolving)} (${String(scores.problemSolving)}/4)
  Technical:      ${"★".repeat(scores.technical)}${"☆".repeat(4 - scores.technical)} (${String(scores.technical)}/4)
  Testing:        ${"★".repeat(scores.testing)}${"☆".repeat(4 - scores.testing)} (${String(scores.testing)}/4)

\u001B[90m${scores.feedback}\u001B[0m
`;
}

export function formatSessionStart(options: {
  questionTitle: string;
  difficulty: string;
  language: string;
  workspacePath: string;
  timeMinutes: number;
}): string {
  return `
\u001B[1m═══════════════════════════════════════════════════\u001B[0m
\u001B[1m  Interview Practice Session\u001B[0m
\u001B[1m═══════════════════════════════════════════════════\u001B[0m

  Question:   ${options.questionTitle}
  Difficulty: ${options.difficulty}
  Language:   ${options.language}
  Time:       ${String(options.timeMinutes)} minutes

  \u001B[90mOpen in your editor:\u001B[0m
  ${options.workspacePath}

  \u001B[90mType /help for commands\u001B[0m
\u001B[1m═══════════════════════════════════════════════════\u001B[0m
`;
}

export function formatSessionEnd(): string {
  return `
\u001B[1m═══════════════════════════════════════════════════\u001B[0m
\u001B[1m  Session Complete\u001B[0m
\u001B[1m═══════════════════════════════════════════════════\u001B[0m
`;
}
