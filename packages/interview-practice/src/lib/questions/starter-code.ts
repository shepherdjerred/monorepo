import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { IOSpec } from "./schemas.ts";

const TEMPLATES_DIR = join(dirname(import.meta.dir), "..", "templates");

export function generateStarterCode(
  language: string,
  io: IOSpec,
  problemTitle: string,
): string {
  const ext = language.startsWith(".") ? language : `.${language}`;
  const templateName = getTemplateName(ext);
  const templatePath = join(TEMPLATES_DIR, templateName);

  try {
    let template = readFileSync(templatePath, "utf-8");
    template = template.replaceAll('{{TITLE}}', problemTitle);
    template = template.replaceAll('{{INPUT_FORMAT}}', io.inputFormat);
    template = template.replaceAll('{{OUTPUT_FORMAT}}', io.outputFormat);
    template = template.replaceAll(
      '{{PARSE_HINT}}',
      io.parseHint ?? "See problem description",
    );
    return template;
  } catch {
    return getDefaultTemplate(ext, io, problemTitle);
  }
}

function getTemplateName(ext: string): string {
  const map: Record<string, string> = {
    ".ts": "typescript.ts.template",
    ".java": "java.java.template",
    ".py": "python.py.template",
    ".go": "go.go.template",
    ".rs": "rust.rs.template",
    ".cpp": "cpp.cpp.template",
  };
  return map[ext] ?? "typescript.ts.template";
}

function getDefaultTemplate(
  ext: string,
  io: IOSpec,
  title: string,
): string {
  switch (ext) {
    case ".ts":
      return String.raw`// ${title}
// Input: ${io.inputFormat}
// Output: ${io.outputFormat}
// ${io.parseHint ?? ""}

const input = await Bun.stdin.text();
const lines = input.trim().split("\n");

// TODO: Parse input and solve
// ${io.parseHint ?? "Parse according to input format"}

console.log("TODO");
`;
    case ".java":
      return `// ${title}
// Input: ${io.inputFormat}
// Output: ${io.outputFormat}

import java.util.*;

public class Solution {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        // TODO: Parse input and solve
        System.out.println("TODO");
    }
}
`;
    case ".py":
      return String.raw`# ${title}
# Input: ${io.inputFormat}
# Output: ${io.outputFormat}

import sys

def solve():
    lines = sys.stdin.read().strip().split("\n")
    # TODO: Parse input and solve
    print("TODO")

solve()
`;
    default:
      return `// ${title}\n// Input: ${io.inputFormat}\n// Output: ${io.outputFormat}\n// TODO: implement\n`;
  }
}

export function getFileExtension(language: string): string {
  const map: Record<string, string> = {
    ts: ".ts",
    typescript: ".ts",
    java: ".java",
    py: ".py",
    python: ".py",
    go: ".go",
    rs: ".rs",
    rust: ".rs",
    cpp: ".cpp",
    "c++": ".cpp",
    c: ".c",
  };
  const lower = language.toLowerCase();
  return map[lower] ?? `.${lower}`;
}

export function getSolutionFilename(ext: string): string {
  const map: Record<string, string> = {
    ".ts": "solution.ts",
    ".java": "Solution.java",
    ".py": "solution.py",
    ".go": "solution.go",
    ".rs": "solution.rs",
    ".cpp": "solution.cpp",
    ".c": "solution.c",
  };
  return map[ext] ?? `solution${ext}`;
}
