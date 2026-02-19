/**
 * Shared response parsing utilities for LLM de-minification responses.
 *
 * Used by: claude-client.ts, openai-client.ts, batch-client.ts, openai-batch.ts
 */

import { validateSource } from "./ast-parser.ts";
import type { DeminifyContext, DeminifyResult } from "./types.ts";

/** Parsed metadata from LLM response */
type ResponseMetadata = {
  suggestedName: string;
  confidence: number;
  parameterNames: Record<string, string>;
  localVariableNames: Record<string, string>;
};

/** Safely extract a string-to-string record from an unknown value */
function toStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") {
      result[k] = v;
    }
  }
  return result;
}

/** Convert unknown object to a property map for safe access */
function toPropertyMap(obj: object): Map<string, unknown> {
  return new Map(Object.entries(obj));
}

/** Parse metadata from an unknown JSON-parsed object */
function parseMetadata(raw: unknown): ResponseMetadata | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const props = toPropertyMap(raw);
  const metadata: ResponseMetadata = {
    suggestedName: "",
    confidence: -1,
    parameterNames: {},
    localVariableNames: {},
  };

  const name = props.get("suggestedName");
  if (typeof name === "string" && name.length > 0) {
    metadata.suggestedName = name;
  }

  const conf = props.get("confidence");
  if (typeof conf === "number") {
    metadata.confidence = conf;
  }

  const params = props.get("parameterNames");
  if (typeof params === "object" && params !== null) {
    metadata.parameterNames = toStringRecord(params);
  }

  const locals = props.get("localVariableNames");
  if (typeof locals === "object" && locals !== null) {
    metadata.localVariableNames = toStringRecord(locals);
  }

  return metadata;
}

/**
 * Parse an LLM response into a DeminifyResult.
 *
 * Extracts code from markdown blocks, validates it parses,
 * and extracts optional metadata JSON.
 */
export function parseLLMResponse(
  responseText: string,
  context: DeminifyContext,
): DeminifyResult {
  // Extract code from markdown code blocks
  const codeMatch = /```(?:javascript|js)?\n?([\s\S]*?)```/.exec(responseText);
  if (codeMatch?.[1] == null || codeMatch[1].length === 0) {
    throw new Error("No code block found in response");
  }

  const deminifiedSource = codeMatch[1].trim();

  // Validate the code parses
  if (!validateSource(deminifiedSource)) {
    throw new Error("De-minified code failed to parse");
  }

  // Try to extract metadata JSON
  let suggestedName =
    context.targetFunction.originalName.length > 0
      ? context.targetFunction.originalName
      : "anonymousFunction";
  let confidence = 0.5;
  let parameterNames: Record<string, string> = {};
  let localVariableNames: Record<string, string> = {};

  // Look for JSON after the code block
  const jsonMatch = /```[\s\S]*?```\s*(\{[\s\S]*\})/.exec(responseText);
  if (jsonMatch?.[1] != null && jsonMatch[1].length > 0) {
    try {
      const raw: unknown = JSON.parse(jsonMatch[1]);
      const metadata = parseMetadata(raw);
      if (metadata) {
        if (metadata.suggestedName.length > 0) {
          suggestedName = metadata.suggestedName;
        }
        if (metadata.confidence >= 0) {
          confidence = metadata.confidence;
        }
        parameterNames = metadata.parameterNames;
        localVariableNames = metadata.localVariableNames;
      }
    } catch {
      // JSON parsing failed, use defaults
    }
  }

  // Try to infer name from the de-minified code if not provided
  if (suggestedName === "anonymousFunction") {
    const funcNameMatch = /(?:function|const|let|var)\s+([a-zA-Z_$][\w$]*)/.exec(
      deminifiedSource,
    );
    if (funcNameMatch?.[1] != null && funcNameMatch[1].length > 0) {
      suggestedName = funcNameMatch[1];
    }
  }

  return {
    functionId: context.targetFunction.id,
    originalSource: context.targetFunction.source,
    deminifiedSource,
    suggestedName,
    confidence,
    parameterNames,
    localVariableNames,
  };
}

/** Get error message from an unknown error value */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
