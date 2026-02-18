/**
 * LLM API calling and response parsing for batch processing.
 *
 * Handles:
 * - OpenAI and Anthropic API calls with raw response capture
 * - Response parsing from JSON (including markdown-wrapped JSON)
 * - Request/response logging to file
 * - Token usage tracking
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { RenameMappings } from "./babel-renamer.ts";
import {
  getBatchSystemPrompt,
  getBatchFunctionPrompt,
  type BatchFunctionInfo,
} from "./prompt-templates.ts";
import type { DeminifyConfig } from "./types.ts";

/** Result from API call with raw data */
export type LLMCallResult = {
  mappings: RenameMappings;
  rawResponse: string;
  inputTokens: number;
  outputTokens: number;
  requestBody: unknown;
  responseBody: unknown;
};

/**
 * Handles LLM API interactions for rename mapping generation.
 */
export class LLMCaller {
  private readonly config: DeminifyConfig;
  private readonly openai: OpenAI | null = null;
  private readonly anthropic: Anthropic | null = null;
  private logFile: string | null = null;
  private requestCount = 0;

  // Token usage tracking
  inputTokensUsed = 0;
  outputTokensUsed = 0;

  constructor(config: DeminifyConfig) {
    this.config = config;

    if (config.provider === "openai") {
      this.openai = new OpenAI({ apiKey: config.apiKey });
    } else {
      this.anthropic = new Anthropic({ apiKey: config.apiKey });
    }
  }

  /**
   * Set log file path for raw request/response logging.
   */
  setLogFile(logPath: string): void {
    this.logFile = logPath;
  }

  /**
   * Call the LLM API to get rename mappings.
   */
  async callLLM(
    functions: BatchFunctionInfo[],
    knownNames: Map<string, string>,
    verbose?: boolean,
  ): Promise<RenameMappings> {
    const systemPrompt = getBatchSystemPrompt();
    const userPrompt = getBatchFunctionPrompt(functions, knownNames);
    const requestId = ++this.requestCount;
    const timestamp = new Date().toISOString();

    if (verbose === true) {
      console.log("\n--- LLM Request ---");
      console.log(`Functions in batch: ${String(functions.length)}`);
      console.log(`Function IDs: ${functions.map((f) => f.id).join(", ")}`);
      console.log(`System prompt length: ${String(systemPrompt.length)} chars`);
      console.log(`User prompt length: ${String(userPrompt.length)} chars`);
      console.log("User prompt preview:");
      console.log(
        userPrompt.slice(0, 500) + (userPrompt.length > 500 ? "..." : ""),
      );
    }

    // Log request
    await this.logToFile({
      timestamp,
      type: "request",
      requestId,
      provider: this.config.provider,
      model: this.config.model,
      systemPrompt,
      userPrompt,
    });

    let result: RenameMappings;
    let llmResult: LLMCallResult;

    try {
      if (this.openai) {
        llmResult = await this.callOpenAIWithRaw(systemPrompt, userPrompt);
      } else if (this.anthropic) {
        llmResult = await this.callAnthropicWithRaw(systemPrompt, userPrompt);
      } else {
        throw new Error("No LLM client configured");
      }

      result = llmResult.mappings;

      // Log response with full request/response bodies
      await this.logToFile({
        timestamp: new Date().toISOString(),
        type: "response",
        requestId,
        provider: this.config.provider,
        model: this.config.model,
        requestBody: llmResult.requestBody,
        rawResponse: llmResult.rawResponse,
        responseBody: llmResult.responseBody,
        parsedResponse: result,
        inputTokens: llmResult.inputTokens,
        outputTokens: llmResult.outputTokens,
      });
    } catch (error) {
      // Log error
      await this.logToFile({
        timestamp: new Date().toISOString(),
        type: "response",
        requestId,
        provider: this.config.provider,
        model: this.config.model,
        error: String(error),
      });
      throw error;
    }

    if (verbose === true) {
      console.log("\n--- LLM Response ---");
      console.log(`Mappings received: ${String(Object.keys(result).length)}`);
      for (const [id, mapping] of Object.entries(result)) {
        const renameCount = Object.keys(mapping.renames).length;
        console.log(
          `  ${id}: ${mapping.functionName ?? "(no name)"} - ${String(renameCount)} renames`,
        );
        if (mapping.description != null && mapping.description.length > 0) {
          console.log(`    "${mapping.description}"`);
        }
      }
    }

    return result;
  }

  /**
   * Call OpenAI API with raw response capture.
   */
  private async callOpenAIWithRaw(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LLMCallResult> {
    const requestBody = {
      model: this.config.model,
      max_completion_tokens: this.config.maxTokens,
      messages: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userPrompt },
      ],
      response_format: { type: "json_object" as const },
    };

    if (!this.openai) {
      throw new Error("OpenAI client not initialized");
    }

    const response = await this.openai.chat.completions.create(requestBody);

    // Track token usage
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    this.inputTokensUsed += inputTokens;
    this.outputTokensUsed += outputTokens;

    const content = response.choices[0]?.message.content;
    if (content == null || content.length === 0) {
      throw new Error("Empty response from OpenAI");
    }

    return {
      mappings: parseResponse(content),
      rawResponse: content,
      inputTokens,
      outputTokens,
      requestBody,
      responseBody: response,
    };
  }

  /**
   * Call Anthropic API with raw response capture.
   */
  private async callAnthropicWithRaw(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<LLMCallResult> {
    const requestBody = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system: systemPrompt,
      messages: [{ role: "user" as const, content: userPrompt }],
    };

    if (!this.anthropic) {
      throw new Error("Anthropic client not initialized");
    }

    const response = await this.anthropic.messages.create(requestBody);

    // Track token usage
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    this.inputTokensUsed += inputTokens;
    this.outputTokensUsed += outputTokens;

    const content = response.content[0];
    if (content?.type !== "text") {
      throw new Error("Unexpected response type from Anthropic");
    }

    return {
      mappings: parseResponse(content.text),
      rawResponse: content.text,
      inputTokens,
      outputTokens,
      requestBody,
      responseBody: response,
    };
  }

  /**
   * Log raw request/response to file.
   */
  private async logToFile(entry: {
    timestamp: string;
    type: "request" | "response";
    requestId: number;
    provider: string;
    model: string;
    systemPrompt?: string;
    userPrompt?: string;
    requestBody?: unknown;
    rawResponse?: string;
    responseBody?: unknown;
    parsedResponse?: RenameMappings;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
  }): Promise<void> {
    if (this.logFile == null || this.logFile.length === 0) {
      return;
    }

    try {
      const logDir = path.join(this.logFile, "..");
      await mkdir(logDir, { recursive: true });

      const separator = "\n" + "=".repeat(80) + "\n";
      const content = separator + JSON.stringify(entry, null, 2) + "\n";
      await appendFile(this.logFile, content);
    } catch (error) {
      console.error("Failed to write to log file:", error);
    }
  }
}

/**
 * Parse LLM response into rename mappings.
 */
export function parseResponse(content: string): RenameMappings {
  // Try to extract JSON from the response
  let jsonStr = content.trim();

  // If wrapped in markdown code blocks, extract
  const jsonMatch = /```(?:json)?\n?([\s\S]*?)```/.exec(jsonStr);
  if (jsonMatch?.[1] != null && jsonMatch[1].length > 0) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    // eslint-disable-next-line custom-rules/no-type-assertions -- AST node type narrowing requires assertion
    const raw = JSON.parse(jsonStr) as Record<string, unknown>;
    const parsed: RenameMappings = {};

    // Validate structure
    for (const [id, mapping] of Object.entries(raw)) {
      if (typeof mapping !== "object" || mapping === null) {
        continue;
      }

      // eslint-disable-next-line custom-rules/no-type-assertions -- AST node type narrowing requires assertion
      const m = mapping as Record<string, unknown>;

      // Ensure renames is an object
      const renames =
        typeof m["renames"] === "object" && m["renames"] !== null
          // eslint-disable-next-line custom-rules/no-type-assertions -- AST node type narrowing requires assertion
          ? (m["renames"] as Record<string, string>)
          : {};

      const entry: RenameMappings[string] = { renames };
      if (typeof m["functionName"] === "string") {
        entry.functionName = m["functionName"];
      }
      if (typeof m["description"] === "string") {
        entry.description = m["description"];
      }
      parsed[id] = entry;
    }

    return parsed;
  } catch {
    console.error(
      "Failed to parse LLM response as JSON:",
      content.slice(0, 200),
    );
    return {};
  }
}
