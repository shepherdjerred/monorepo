import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateStarterCode, getSolutionFilename, getFileExtension } from "#lib/questions/starter-code.ts";
import type { LeetcodeQuestion } from "#lib/questions/schemas.ts";

export function scaffoldLeetcodeWorkspace(
  workspacePath: string,
  question: LeetcodeQuestion,
  language: string,
  currentPart: number,
): { solutionPath: string; problemPath: string } {
  const ext = getFileExtension(language);
  const solutionFilename = getSolutionFilename(ext);
  const solutionPath = join(workspacePath, solutionFilename);
  const problemPath = join(workspacePath, "problem.md");

  const starterCode = generateStarterCode(ext, question.io, question.title);
  writeFileSync(solutionPath, starterCode);

  const problemContent = buildProblemMarkdown(question, currentPart);
  writeFileSync(problemPath, problemContent);

  // Write go.mod for Go projects
  if (ext === ".go") {
    writeFileSync(
      join(workspacePath, "go.mod"),
      `module solution\n\ngo 1.22\n`,
    );
  }

  return { solutionPath, problemPath };
}

function buildProblemMarkdown(
  question: LeetcodeQuestion,
  upToPart: number,
): string {
  const parts: string[] = [];
  parts.push(`# ${question.title}\n`);
  parts.push(`**Difficulty:** ${question.difficulty}\n`);
  parts.push(`**Tags:** ${question.tags.join(", ")}\n`);
  parts.push(`## Description\n`);
  parts.push(question.description + "\n");

  if (question.constraints.length > 0) {
    parts.push(`## Constraints\n`);
    for (const c of question.constraints) {
      parts.push(`- ${c}`);
    }
    parts.push("");
  }

  parts.push(`## Input/Output\n`);
  parts.push(`- **Input:** ${question.io.inputFormat}`);
  parts.push(`- **Output:** ${question.io.outputFormat}`);
  if (question.io.parseHint) {
    parts.push(`- **Format:** ${question.io.parseHint}`);
  }
  parts.push("");

  const visibleParts = question.parts.filter((p) => p.partNumber <= upToPart);
  for (const part of visibleParts) {
    if (part.partNumber > 1) {
      parts.push(`## Part ${part.partNumber}\n`);
      parts.push(part.prompt + "\n");
    }
  }

  return parts.join("\n");
}

export function updateProblemForNewPart(
  workspacePath: string,
  question: LeetcodeQuestion,
  newPart: number,
): void {
  const problemPath = join(workspacePath, "problem.md");
  const content = buildProblemMarkdown(question, newPart);
  writeFileSync(problemPath, content);
}

export function readSolutionFile(solutionPath: string): string | null {
  try {
    return Bun.file(solutionPath).text() as unknown as string;
  } catch {
    return null;
  }
}
