import type { CodeSegment, DeminifyContext } from "./types.ts";

/** Get the system prompt for de-minification */
export function getSystemPrompt(): string {
  return `You are an expert JavaScript developer tasked with de-minifying code.
Your goal is to make minified JavaScript human-readable by:

1. Renaming single-letter variables to descriptive names based on their usage
2. Renaming cryptic function names to reflect their purpose
3. Adding appropriate whitespace and formatting
4. Preserving EXACT functionality - the code must work identically

Guidelines:
- Analyze the code's behavior to infer meaningful names
- Use camelCase for variables and functions
- Use PascalCase for classes
- Use UPPER_SNAKE_CASE for constants
- Keep parameter order and count identical
- Do not change the logic or control flow
- Do not inline or extract functions
- Do not add or remove code
- Do not add comments

Response format:
1. First, output the de-minified code wrapped in \`\`\`javascript code blocks
2. Then, on a new line, output a JSON object with metadata:
   - suggestedName: A descriptive name for this function
   - confidence: 0.0 to 1.0 rating of how confident you are
   - parameterNames: Object mapping original param names to suggested names
   - localVariableNames: Object mapping original local var names to suggested names

Example response:
\`\`\`javascript
function filterArrayByPredicate(items, predicate) {
  const results = [];
  for (let index = 0; index < items.length; index++) {
    if (predicate(items[index])) {
      results.push(items[index]);
    }
  }
  return results;
}
\`\`\`
{"suggestedName":"filterArrayByPredicate","confidence":0.9,"parameterNames":{"R":"items","A":"predicate"},"localVariableNames":{"_":"results","B":"index"}}`;
}

/** Generate the user prompt for a specific function */
export function getFunctionPrompt(context: DeminifyContext): string {
  const parts: string[] = [];

  // Main instruction
  parts.push("De-minify this JavaScript function:\n");

  // The target function
  parts.push("```javascript");
  parts.push(context.targetFunction.source);
  parts.push("```\n");

  // Caller context
  if (context.callers.length > 0) {
    parts.push("## Context: Functions that call this function\n");
    for (const caller of context.callers) {
      const name = caller.suggestedName ?? caller.id;
      parts.push(`### ${name}`);
      if (caller.deminifiedSource) {
        parts.push("```javascript");
        parts.push(caller.deminifiedSource);
        parts.push("```");
      } else {
        parts.push("```javascript");
        parts.push(caller.originalSource);
        parts.push("```");
      }
      parts.push("");
    }
  }

  // Callee context
  if (context.callees.length > 0) {
    parts.push("## Context: Functions this function calls\n");
    for (const callee of context.callees) {
      const name = callee.suggestedName ?? callee.id;
      parts.push(`### ${name}`);
      if (callee.deminifiedSource) {
        parts.push("```javascript");
        parts.push(callee.deminifiedSource);
        parts.push("```");
      } else {
        parts.push("```javascript");
        parts.push(callee.originalSource);
        parts.push("```");
      }
      parts.push("");
    }
  }

  // Known name mappings
  if (context.knownNames.size > 0) {
    parts.push("## Known name mappings");
    parts.push("These identifiers have already been renamed:");
    const entries = Array.from(context.knownNames.entries()).slice(0, 20);
    for (const [original, suggested] of entries) {
      parts.push(`- \`${original}\` -> \`${suggested}\``);
    }
    parts.push("");
  }

  // File context
  if (context.fileContext.imports.length > 0) {
    parts.push("## Imports in this file");
    for (const imp of context.fileContext.imports.slice(0, 10)) {
      parts.push(`- from "${imp.source}": ${imp.specifiers.join(", ")}`);
    }
    parts.push("");
  }

  if (context.fileContext.exports.length > 0) {
    parts.push("## Exports from this file");
    for (const exp of context.fileContext.exports.slice(0, 10)) {
      if (exp.name === exp.localName) {
        parts.push(`- ${exp.name}`);
      } else {
        parts.push(`- ${exp.localName} as ${exp.name}`);
      }
    }
    parts.push("");
  }

  // Function metadata hints
  const func = context.targetFunction;
  const hints: string[] = [];

  if (func.isAsync) hints.push("async function");
  if (func.isGenerator) hints.push("generator function");
  if (func.type === "arrow-function") hints.push("arrow function");
  if (func.type === "method") hints.push("class method");
  if (func.type === "constructor") hints.push("constructor");
  if (func.type === "getter") hints.push("getter");
  if (func.type === "setter") hints.push("setter");
  if (func.params.length > 0) {
    const paramHints = func.params.map((p) => {
      let h = p.name || "[destructured]";
      if (p.isRest) h = `...${h}`;
      if (p.hasDefault) h = `${h}=default`;
      return h;
    });
    hints.push(`parameters: (${paramHints.join(", ")})`);
  }

  if (hints.length > 0) {
    parts.push("## Function metadata");
    parts.push(hints.join(", "));
    parts.push("");
  }

  return parts.join("\n");
}

/** Generate prompt for top-level code segment */
export function getTopLevelPrompt(
  segment: CodeSegment,
  knownNames: Map<string, string>,
): string {
  const parts: string[] = [];

  parts.push("De-minify this top-level JavaScript code segment:\n");

  parts.push("```javascript");
  parts.push(segment.source);
  parts.push("```\n");

  if (knownNames.size > 0) {
    parts.push("## Known name mappings");
    parts.push("These identifiers have already been renamed:");
    const entries = Array.from(knownNames.entries()).slice(0, 30);
    for (const [original, suggested] of entries) {
      parts.push(`- \`${original}\` -> \`${suggested}\``);
    }
    parts.push("");
  }

  parts.push("Apply the known name mappings and format the code for readability.");
  parts.push("Output only the de-minified code in ```javascript blocks.");

  return parts.join("\n");
}

/** Generate a simpler prompt for small/trivial functions */
export function getSimpleFunctionPrompt(source: string): string {
  return `De-minify this small JavaScript function. Rename variables to be descriptive and format for readability.

\`\`\`javascript
${source}
\`\`\`

Output only the de-minified code in \`\`\`javascript blocks, followed by a JSON metadata object on a new line.`;
}

/** Estimate token count for a prompt (rough approximation) */
export function estimatePromptTokens(prompt: string): number {
  // Rough approximation: ~4 characters per token for code
  return Math.ceil(prompt.length / 4);
}

// ============================================================================
// NEW: Batch prompts for JSON rename mappings
// Key principle: LLM only outputs rename mappings, Babel does actual renaming
// ============================================================================

/** System prompt for batch rename mapping */
export function getBatchSystemPrompt(): string {
  return `You are an expert JavaScript developer analyzing minified code.
Your task is to suggest meaningful names for identifiers based on their usage.

IMPORTANT: You do NOT output code. You only output JSON rename mappings.
The actual renaming is done by Babel to guarantee functional equivalence.

For each function, analyze its behavior and suggest:
1. A descriptive function name (if it has one)
2. A brief description (1-2 sentences)
3. Rename mappings for parameters and local variables

Guidelines:
- Use camelCase for variables and functions
- Use PascalCase for classes
- Use UPPER_SNAKE_CASE for constants
- Base names on actual usage and behavior, not guesses
- If unsure about a name, keep the original
- Focus on the most impactful renames (parameters, key variables)

Response format: JSON object with function IDs as keys.
Each function entry has: functionName, description, renames (object mapping old->new)

Example response:
{
  "add_0_34": {
    "functionName": "add",
    "description": "Adds two numbers together",
    "renames": { "a": "num1", "b": "num2" }
  },
  "processItems_40_120": {
    "functionName": "filterValidItems",
    "description": "Filters an array to only include valid items based on a predicate",
    "renames": { "t": "items", "r": "predicate", "n": "result", "i": "index" }
  }
}`;
}

/** Function info for batch processing */
export interface BatchFunctionInfo {
  /** Unique function ID (name_start_end) */
  id: string;
  /** Source code of the function */
  source: string;
  /** List of identifiers available to rename */
  identifiers?: string[];
}

/** Generate user prompt for a batch of functions */
export function getBatchFunctionPrompt(
  functions: BatchFunctionInfo[],
  knownNames?: Map<string, string>,
): string {
  const parts: string[] = [];

  parts.push("Analyze these JavaScript functions and suggest rename mappings.\n");
  parts.push("Output ONLY a JSON object with function IDs as keys.\n");

  // Known name mappings from previous rounds
  if (knownNames && knownNames.size > 0) {
    parts.push("## Already renamed identifiers (for context)");
    parts.push("These names have been applied to the codebase:");
    const entries = Array.from(knownNames.entries()).slice(0, 30);
    for (const [original, suggested] of entries) {
      parts.push(`- \`${original}\` → \`${suggested}\``);
    }
    parts.push("");
  }

  parts.push("## Functions to analyze\n");

  for (const fn of functions) {
    parts.push(`### ${fn.id}`);
    if (fn.identifiers && fn.identifiers.length > 0) {
      parts.push(`Identifiers: ${fn.identifiers.join(", ")}`);
    }
    parts.push("```javascript");
    parts.push(fn.source);
    parts.push("```");
    parts.push("");
  }

  parts.push("Output JSON with rename mappings for each function ID:");

  return parts.join("\n");
}

/** Estimate tokens for a batch of functions */
export function estimateBatchTokens(functions: BatchFunctionInfo[]): number {
  let total = 0;

  // System prompt tokens (roughly 400)
  total += 400;

  // User prompt overhead
  total += 200;

  // Each function
  for (const fn of functions) {
    // ID and wrapper
    total += 20;
    // Source code
    total += estimatePromptTokens(fn.source);
    // Identifiers list
    if (fn.identifiers) {
      total += fn.identifiers.length * 2;
    }
  }

  return total;
}

/** Estimate output tokens for a batch of functions */
export function estimateBatchOutputTokens(functions: BatchFunctionInfo[]): number {
  let total = 0;

  // JSON wrapper overhead
  total += 50;

  // Each function's output
  for (const fn of functions) {
    // Rough estimate: ~5 tokens per identifier renamed + metadata
    const identifierCount = fn.identifiers?.length ?? 5;
    total += 30 + identifierCount * 5;
  }

  return total;
}

/** Estimate output tokens for a function */
export function estimateOutputTokens(functionSource: string): number {
  // De-minified code is typically 2-3x longer due to whitespace and longer names
  const expandedLength = functionSource.length * 2.5;
  // Add ~100 tokens for metadata JSON
  return Math.ceil(expandedLength / 4) + 100;
}
