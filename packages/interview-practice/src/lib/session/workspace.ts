import path from "node:path";
import { generateStarterCode, getSolutionFilename, getFileExtension } from "#lib/questions/starter-code.ts";
import type { LeetcodeQuestion } from "#lib/questions/schemas.ts";

export async function scaffoldLeetcodeWorkspace(
  workspacePath: string,
  question: LeetcodeQuestion,
  language: string,
  currentPart: number,
): Promise<{ solutionPath: string; problemPath: string }> {
  const ext = getFileExtension(language);
  const solutionFilename = getSolutionFilename(ext);
  const solutionPath = path.join(workspacePath, solutionFilename);
  const problemPath = path.join(workspacePath, "problem.md");

  const starterCode = await generateStarterCode(ext, question.io, question.title);
  await Bun.write(solutionPath, starterCode);

  const problemContent = buildProblemMarkdown(question, currentPart);
  await Bun.write(problemPath, problemContent);

  // Write go.mod for Go projects
  if (ext === ".go") {
    await Bun.write(
      path.join(workspacePath, "go.mod"),
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
  if (question.io.parseHint !== undefined) {
    parts.push(`- **Format:** ${question.io.parseHint}`);
  }
  parts.push("");

  const visibleParts = question.parts.filter((p) => p.partNumber <= upToPart);
  for (const part of visibleParts) {
    if (part.partNumber > 1) {
      parts.push(`## Part ${String(part.partNumber)}\n`);
      parts.push(part.prompt + "\n");
    }
  }

  return parts.join("\n");
}

export async function updateProblemForNewPart(
  workspacePath: string,
  question: LeetcodeQuestion,
  newPart: number,
): Promise<void> {
  const problemPath = path.join(workspacePath, "problem.md");
  const content = buildProblemMarkdown(question, newPart);
  await Bun.write(problemPath, content);
}

export async function readSolutionFile(solutionPath: string): Promise<string | null> {
  try {
    return await Bun.file(solutionPath).text();
  } catch {
    return null;
  }
}
