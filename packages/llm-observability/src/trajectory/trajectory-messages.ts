import { z } from "zod";
import type {
  TrajectoryMessage,
  TrajectoryMessagePart,
} from "@shepherdjerred/ops-model/llm-traces.ts";

const LooseRecordSchema = z.record(z.string(), z.unknown());
const UnknownArraySchema = z.array(z.unknown());
const NumberArraySchema = z.array(z.number());

export function safeJsonParse(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function stringifyJson(value: unknown): string {
  if (typeof value === "string") {
    const parsed = safeJsonParse(value);
    return typeof parsed === "string" ? value : JSON.stringify(parsed);
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

function extractTextFromSystemBlock(item: unknown): string | null {
  if (typeof item === "string") {
    return item;
  }
  const obj = LooseRecordSchema.safeParse(item);
  if (!obj.success) {
    return null;
  }
  if (typeof obj.data["content"] === "string") {
    return obj.data["content"];
  }
  return typeof obj.data["text"] === "string"
    ? obj.data["text"]
    : JSON.stringify(obj.data);
}

export function normalizeSystemInstructions(raw: unknown): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const parsed = safeJsonParse(raw);
  if (typeof parsed === "string") {
    return parsed === "" ? null : parsed;
  }
  const arr = UnknownArraySchema.safeParse(parsed);
  if (arr.success) {
    const pieces: string[] = [];
    for (const item of arr.data) {
      const text = extractTextFromSystemBlock(item);
      if (text !== null && text !== "") {
        pieces.push(text);
      }
    }
    return pieces.length === 0 ? null : pieces.join("\n\n");
  }
  const single = extractTextFromSystemBlock(parsed);
  return single === "" ? null : single;
}

function normalizeRole(
  rawRole: unknown,
): "system" | "user" | "assistant" | "tool" | "other" {
  if (
    rawRole === "system" ||
    rawRole === "user" ||
    rawRole === "assistant" ||
    rawRole === "tool"
  ) {
    return rawRole;
  }
  return rawRole === "developer" ? "system" : "other";
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function parseToolCallPart(
  obj: Record<string, unknown>,
): TrajectoryMessagePart {
  return {
    kind: "tool-call",
    callId:
      readOptionalString(obj, "id") ??
      readOptionalString(obj, "toolCallId") ??
      null,
    toolName:
      readOptionalString(obj, "name") ??
      readOptionalString(obj, "toolName") ??
      "unknown",
    argumentsJson: stringifyJson(
      obj["arguments"] ?? obj["input"] ?? obj["args"] ?? {},
    ),
  };
}

function parseToolResultPart(
  obj: Record<string, unknown>,
): TrajectoryMessagePart {
  return {
    kind: "tool-result",
    callId:
      readOptionalString(obj, "id") ??
      readOptionalString(obj, "toolCallId") ??
      readOptionalString(obj, "tool_use_id") ??
      null,
    toolName:
      readOptionalString(obj, "name") ??
      readOptionalString(obj, "toolName") ??
      null,
    outputJson: stringifyJson(
      obj["response"] ??
        obj["output"] ??
        obj["result"] ??
        obj["content"] ??
        null,
    ),
    isError: obj["is_error"] === true || obj["isError"] === true,
  };
}

function parsePartObject(obj: Record<string, unknown>): TrajectoryMessagePart {
  const type = typeof obj["type"] === "string" ? obj["type"] : "";
  if (type === "text" || type === "input_text" || type === "output_text") {
    return {
      kind: "text",
      text:
        readOptionalString(obj, "text") ??
        readOptionalString(obj, "content") ??
        "",
    };
  }
  if (type === "reasoning" || type === "thinking") {
    return {
      kind: "reasoning",
      text:
        readOptionalString(obj, "thinking") ??
        readOptionalString(obj, "text") ??
        readOptionalString(obj, "content") ??
        "",
    };
  }
  if (type === "tool_call" || type === "tool-call" || type === "tool_use") {
    return parseToolCallPart(obj);
  }
  if (
    type === "tool_call_response" ||
    type === "tool-result" ||
    type === "tool_result"
  ) {
    return parseToolResultPart(obj);
  }
  return {
    kind: "json",
    label: type === "" ? null : type,
    json: JSON.stringify(obj),
  };
}

function parsePartItem(item: unknown): TrajectoryMessagePart {
  if (typeof item === "string") {
    return { kind: "text", text: item };
  }
  const obj = LooseRecordSchema.safeParse(item);
  return obj.success
    ? parsePartObject(obj.data)
    : { kind: "json", label: null, json: stringifyJson(item) };
}

function parseOpenAiToolCalls(rawToolCalls: unknown): TrajectoryMessagePart[] {
  const arr = UnknownArraySchema.safeParse(rawToolCalls);
  if (!arr.success) {
    return [];
  }
  const parts: TrajectoryMessagePart[] = [];
  for (const entry of arr.data) {
    const tc = LooseRecordSchema.safeParse(entry);
    if (!tc.success) {
      continue;
    }
    const fnObj = LooseRecordSchema.safeParse(tc.data["function"]);
    const toolName =
      (fnObj.success ? readOptionalString(fnObj.data, "name") : null) ??
      readOptionalString(tc.data, "toolName") ??
      readOptionalString(tc.data, "name") ??
      "unknown";
    const args =
      (fnObj.success ? fnObj.data["arguments"] : undefined) ??
      tc.data["args"] ??
      tc.data["input"] ??
      {};
    parts.push({
      kind: "tool-call",
      callId:
        readOptionalString(tc.data, "id") ??
        readOptionalString(tc.data, "toolCallId"),
      toolName,
      argumentsJson: stringifyJson(args),
    });
  }
  return parts;
}

function parseMessageContentParts(
  role: "system" | "user" | "assistant" | "tool" | "other",
  record: Record<string, unknown>,
): TrajectoryMessagePart[] {
  const content = record["content"];
  if (role === "tool" && content !== undefined && !Array.isArray(content)) {
    return [
      {
        kind: "tool-result",
        callId:
          readOptionalString(record, "tool_call_id") ??
          readOptionalString(record, "toolCallId"),
        toolName: readOptionalString(record, "name"),
        outputJson: stringifyJson(content),
        isError: record["is_error"] === true,
      },
    ];
  }
  if (typeof content === "string") {
    return [{ kind: "text", text: content }];
  }
  if (Array.isArray(content)) {
    return content.map((item) => parsePartItem(item));
  }
  return content === undefined || content === null
    ? []
    : [{ kind: "json", label: null, json: stringifyJson(content) }];
}

function parseMessageRecord(
  record: Record<string, unknown>,
  defaultRole: "user" | "assistant",
): TrajectoryMessage {
  const role =
    record["role"] === undefined ? defaultRole : normalizeRole(record["role"]);
  const partsField = UnknownArraySchema.safeParse(record["parts"]);
  if (partsField.success) {
    return {
      role,
      parts: partsField.data.map((item) => parsePartItem(item)),
    };
  }
  const parts = parseMessageContentParts(role, record);
  parts.push(...parseOpenAiToolCalls(record["tool_calls"]));
  return { role, parts };
}

export function parseTrajectoryMessages(
  raw: unknown,
  defaultRole: "user" | "assistant" = "user",
): TrajectoryMessage[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  const parsed = safeJsonParse(raw);
  if (typeof parsed === "string") {
    return parsed === ""
      ? []
      : [{ role: defaultRole, parts: [{ kind: "text", text: parsed }] }];
  }
  const arr = UnknownArraySchema.safeParse(parsed);
  if (arr.success) {
    return arr.data.map((entry) => {
      const rec = LooseRecordSchema.safeParse(entry);
      return rec.success
        ? parseMessageRecord(rec.data, defaultRole)
        : { role: defaultRole, parts: [parsePartItem(entry)] };
    });
  }
  const obj = LooseRecordSchema.safeParse(parsed);
  if (!obj.success) {
    return [];
  }
  if (obj.data["messages"] !== undefined) {
    return parseTrajectoryMessages(obj.data["messages"], defaultRole);
  }
  return typeof obj.data["prompt"] === "string"
    ? [{ role: "user", parts: [{ kind: "text", text: obj.data["prompt"] }] }]
    : [parseMessageRecord(obj.data, defaultRole)];
}

export function buildLegacyAiSdkOutputMessages(input: {
  responseText: unknown;
  responseObject: unknown;
  responseToolCalls: unknown;
}): TrajectoryMessage[] {
  const parts: TrajectoryMessagePart[] = [];
  if (typeof input.responseText === "string" && input.responseText !== "") {
    parts.push({ kind: "text", text: input.responseText });
  }
  if (input.responseObject !== undefined && input.responseObject !== null) {
    parts.push({
      kind: "json",
      label: "object",
      json: stringifyJson(input.responseObject),
    });
  }
  if (
    input.responseToolCalls !== undefined &&
    input.responseToolCalls !== null
  ) {
    parts.push(...parseOpenAiToolCalls(safeJsonParse(input.responseToolCalls)));
  }
  return parts.length === 0 ? [] : [{ role: "assistant", parts }];
}

function unwrapStringElement(item: unknown): string {
  const parsed = safeJsonParse(item);
  return typeof parsed === "string" ? parsed : JSON.stringify(parsed);
}

function truncatePreview(text: string, maxChars = 160): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

function vectorLength(candidate: unknown): number | null {
  const direct = NumberArraySchema.safeParse(safeJsonParse(candidate));
  return direct.success ? direct.data.length : null;
}

export function extractEmbeddingSummary(input: {
  rawValue: unknown;
  rawValues: unknown;
  rawEmbedding: unknown;
  rawEmbeddings: unknown;
  explicitDimensions: number | undefined;
}): {
  inputCount: number;
  inputPreviews: string[];
  dimensions: number | null;
} {
  const parsedValues = safeJsonParse(input.rawValues);
  let rawItems: unknown[] = [];
  if (Array.isArray(parsedValues)) {
    rawItems = parsedValues;
  } else if (input.rawValue !== undefined && input.rawValue !== null) {
    rawItems = [input.rawValue];
  }

  let dimensions = input.explicitDimensions ?? null;
  if (dimensions === null && input.rawEmbedding !== undefined) {
    dimensions = vectorLength(input.rawEmbedding);
  }
  if (dimensions === null && input.rawEmbeddings !== undefined) {
    const parsedBatch = safeJsonParse(input.rawEmbeddings);
    if (Array.isArray(parsedBatch) && parsedBatch.length > 0) {
      dimensions = vectorLength(parsedBatch[0]);
    }
  }

  return {
    inputCount: rawItems.length,
    inputPreviews: rawItems
      .slice(0, 20)
      .map((entry) => truncatePreview(unwrapStringElement(entry))),
    dimensions,
  };
}
