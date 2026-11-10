import { z } from "zod";
import {
  asArray,
  asRecord,
  asString,
  parseJsonOrText,
  type JsonRecord,
} from "./json.ts";
import type { BlockSection, CaptureFormat } from "./request.ts";

/**
 * Renders stored blocks as OpenTelemetry GenAI message parts (`text`,
 * `reasoning`, `tool_call`, `tool_call_response`), so a request's new blocks
 * can become a span's `gen_ai.input.messages` without reshaping. Tool
 * definitions render as `tool_definition`; anything unrecognized as `other`.
 */

export type CapturePart =
  | { readonly type: "text"; readonly content: string }
  | { readonly type: "reasoning"; readonly content: string }
  | {
      readonly type: "tool_call";
      readonly id: string | null;
      readonly name: string;
      readonly arguments: unknown;
    }
  | {
      readonly type: "tool_call_response";
      readonly id: string | null;
      readonly response: unknown;
    }
  | {
      readonly type: "tool_definition";
      readonly name: string;
      /** The enclosing namespace path, such as `functions`; null at top level. */
      readonly namespace: string | null;
      readonly description: string | null;
      /** The argument JSON Schema, or a custom tool's grammar `format`. */
      readonly parameters: unknown;
    }
  | { readonly type: "other"; readonly content: unknown };

export type RenderedBlock = {
  readonly role: string | null;
  readonly parts: readonly CapturePart[];
};

function parseArguments(value: unknown): unknown {
  return typeof value === "string" ? parseJsonOrText(value) : value;
}

const TextPartsSchema = z.array(z.object({ text: z.string() }));

/** A string, or an array of text parts joined; null for anything else. */
function contentText(value: unknown): string | null {
  if (typeof value === "string") return value;
  const parts = TextPartsSchema.safeParse(value);
  return parts.success ? parts.data.map((part) => part.text).join("\n") : null;
}

function anthropicPart(value: unknown): CapturePart {
  if (typeof value === "string") return { type: "text", content: value };
  const part = asRecord(value) ?? {};
  switch (part["type"]) {
    case "text":
      return { type: "text", content: asString(part["text"]) ?? "" };
    case "thinking":
      return { type: "reasoning", content: asString(part["thinking"]) ?? "" };
    case "redacted_thinking":
      return { type: "reasoning", content: "" };
    case "tool_use":
    case "server_tool_use":
      return {
        type: "tool_call",
        id: asString(part["id"]),
        name: asString(part["name"]) ?? "",
        arguments: part["input"] ?? null,
      };
    case "tool_result":
      return {
        type: "tool_call_response",
        id: asString(part["tool_use_id"]),
        response: contentText(part["content"]) ?? part["content"] ?? null,
      };
    default:
      return { type: "other", content: value };
  }
}

const MAX_TOOL_NESTING = 4;

function qualified(
  namespace: string | null,
  name: string | null,
): string | null {
  if (name === null) return namespace;
  return namespace === null ? name : `${namespace}.${name}`;
}

/** The tools a container holds: a Codex namespace or a Gemini declaration list. */
function nestedTools(tool: JsonRecord): readonly unknown[] | null {
  return asArray(tool["tools"]) ?? asArray(tool["functionDeclarations"]);
}

/**
 * One tool definition per callable tool. Containers are expanded: Codex
 * groups its tools into `{ type: "namespace", name, tools }` (sent at the top
 * level or inside an `additional_tools` item), and Gemini into
 * `{ functionDeclarations }`. Anthropic (`input_schema`), OpenAI function
 * (`parameters` or `function.parameters`), and custom grammar (`format`)
 * tools each become one part.
 */
function toolDefinitions(
  value: unknown,
  namespace: string | null = null,
  depth = 0,
): CapturePart[] {
  const tool = asRecord(value) ?? {};
  const nested = nestedTools(tool);
  if (nested !== null && depth < MAX_TOOL_NESTING) {
    const inner = qualified(namespace, asString(tool["name"]));
    return nested.flatMap((entry) => toolDefinitions(entry, inner, depth + 1));
  }
  const fn = asRecord(tool["function"]);
  return [
    {
      type: "tool_definition",
      name:
        asString(fn?.["name"]) ??
        asString(tool["name"]) ??
        asString(tool["type"]) ??
        "",
      namespace,
      description:
        asString(fn?.["description"]) ?? asString(tool["description"]),
      parameters:
        fn?.["parameters"] ??
        tool["parameters"] ??
        tool["input_schema"] ??
        tool["format"] ??
        null,
    },
  ];
}

function responsesMessageParts(content: unknown): CapturePart[] {
  if (typeof content === "string") return [{ type: "text", content }];
  return (asArray(content) ?? []).map((entry): CapturePart => {
    const text = asString(asRecord(entry)?.["text"]);
    return text === null
      ? { type: "other", content: entry }
      : { type: "text", content: text };
  });
}

function responsesItem(value: unknown): RenderedBlock {
  if (typeof value === "string") {
    return { role: "user", parts: [{ type: "text", content: value }] };
  }
  const item = asRecord(value) ?? {};
  const role = asString(item["role"]);
  // A Responses message may omit `type`; a role alone implies it.
  const type =
    asString(item["type"]) ?? (item["role"] === undefined ? "" : "message");
  switch (type) {
    case "message":
      return { role, parts: responsesMessageParts(item["content"]) };
    case "additional_tools":
      return {
        role,
        parts: (asArray(item["tools"]) ?? []).flatMap((tool) =>
          toolDefinitions(tool),
        ),
      };
    case "reasoning":
      return {
        role: "assistant",
        parts: [
          {
            type: "reasoning",
            content: (asArray(item["summary"]) ?? [])
              .map((entry) => asString(asRecord(entry)?.["text"]) ?? "")
              .join("\n"),
          },
        ],
      };
    case "function_call":
    case "custom_tool_call":
      return {
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: asString(item["call_id"]),
            name: asString(item["name"]) ?? "",
            arguments: parseArguments(item["arguments"] ?? item["input"]),
          },
        ],
      };
    case "function_call_output":
    case "custom_tool_call_output":
      return {
        role: "tool",
        parts: [
          {
            type: "tool_call_response",
            id: asString(item["call_id"]),
            response: item["output"] ?? null,
          },
        ],
      };
    default:
      return { role, parts: [{ type: "other", content: value }] };
  }
}

function chatContentParts(
  role: string | null,
  message: JsonRecord,
): CapturePart[] {
  const content = message["content"];
  const text = contentText(content);
  if (role === "tool") {
    return [
      {
        type: "tool_call_response",
        id: asString(message["tool_call_id"]),
        response: text ?? content ?? null,
      },
    ];
  }
  if (text !== null)
    return text.length === 0 ? [] : [{ type: "text", content: text }];
  return content === undefined || content === null
    ? []
    : [{ type: "other", content }];
}

function chatMessage(value: unknown): RenderedBlock {
  const message = asRecord(value) ?? {};
  const role = asString(message["role"]);
  const calls = (asArray(message["tool_calls"]) ?? []).map(
    (call): CapturePart => {
      const record = asRecord(call) ?? {};
      const fn = asRecord(record["function"]) ?? {};
      return {
        type: "tool_call",
        id: asString(record["id"]),
        name: asString(fn["name"]) ?? "",
        arguments: parseArguments(fn["arguments"]),
      };
    },
  );
  return { role, parts: [...chatContentParts(role, message), ...calls] };
}

function anthropicMessage(value: unknown): RenderedBlock {
  const message = asRecord(value) ?? {};
  const content = message["content"];
  return {
    role: asString(message["role"]),
    parts:
      typeof content === "string"
        ? [{ type: "text", content }]
        : (asArray(content) ?? []).map((part) => anthropicPart(part)),
  };
}

/** One stored block as OpenTelemetry GenAI message parts. */
export function renderBlock(
  format: CaptureFormat,
  section: BlockSection,
  value: unknown,
): RenderedBlock {
  if (section === "tools") return { role: null, parts: toolDefinitions(value) };
  if (section === "system")
    return { role: "system", parts: [anthropicPart(value)] };
  switch (format) {
    case "openai-responses":
      return responsesItem(value);
    case "openai-chat":
      return chatMessage(value);
    case "anthropic-messages":
    case "unknown":
      return anthropicMessage(value);
  }
}

export type ResponseSummary = {
  readonly text: string;
  readonly reasoning: string;
  readonly toolCalls: readonly {
    readonly id: string | null;
    readonly name: string;
    readonly arguments: unknown;
  }[];
  readonly stopReason: string | null;
};

function responseParts(
  format: CaptureFormat,
  value: JsonRecord,
): CapturePart[] {
  switch (format) {
    case "anthropic-messages":
      return (asArray(value["content"]) ?? []).map((part) =>
        anthropicPart(part),
      );
    case "openai-responses":
      return (asArray(value["output"]) ?? []).flatMap(
        (item) => responsesItem(item).parts,
      );
    case "openai-chat":
      return [
        ...chatMessage(asRecord(asArray(value["choices"])?.[0])?.["message"])
          .parts,
      ];
    case "unknown":
      return [];
  }
}

/** The final answer: text, reasoning, and tool calls. */
export function summarizeResponse(
  format: CaptureFormat,
  value: JsonRecord,
  stopReason: string | null,
): ResponseSummary {
  const parts = responseParts(format, value);
  const text: string[] = [];
  const reasoning: string[] = [];
  const toolCalls: { id: string | null; name: string; arguments: unknown }[] =
    [];
  for (const part of parts) {
    switch (part.type) {
      case "text":
        text.push(part.content);
        break;
      case "reasoning":
        reasoning.push(part.content);
        break;
      case "tool_call":
        toolCalls.push({
          id: part.id,
          name: part.name,
          arguments: part.arguments,
        });
        break;
      case "tool_call_response":
      case "tool_definition":
      case "other":
        break;
    }
  }
  return {
    text: text.join(""),
    reasoning: reasoning.join("\n"),
    toolCalls,
    stopReason,
  };
}
