import type { RecordedRunEvent } from "@shepherdjerred/pr-fleet-controller/src/run-events.ts";
import type { SpanRecord, TimelineItem } from "#lib/fold";

export type Category =
  | "run"
  | "tick"
  | "chat"
  | "model"
  | "reasoning"
  | "tool"
  | "cmd"
  | "worker"
  | "evidence"
  | "change"
  | "operator"
  | "error"
  | "muted";

export type Descriptor = {
  category: Category;
  icon: string;
  title: string;
  meta?: string;
  text?: string;
  body?: unknown;
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function num(value: unknown): string {
  return typeof value === "number" ? String(value) : "?";
}

function commandLine(executable: unknown, args: unknown): string {
  const parts = Array.isArray(args) ? args.map(String) : [];
  return [asString(executable) ?? "?", ...parts].join(" ");
}

type Payload = RecordedRunEvent["payload"];

function describeLifecycle(kind: string, p: Payload): Descriptor {
  switch (kind) {
    case "run.started":
      return {
        category: "run",
        icon: "▶",
        title: "Run started",
        meta: asString(p["phase"]) ?? "",
        body: p,
      };
    case "run.completed":
      return { category: "run", icon: "✓", title: "Run completed" };
    case "run.failed":
      return {
        category: "error",
        icon: "✗",
        title: "Run failed",
        body: p["error"],
      };
    case "controller.initialized":
      return { category: "run", icon: "⚙", title: "Controller initialized" };
    case "operator.input":
      return {
        category: "operator",
        icon: "⌨",
        title: "Operator input",
        text: asString(p["line"]) ?? "",
      };
    default:
      return { category: "run", icon: "⏹", title: kind };
  }
}

function describeTick(kind: string, p: Payload): Descriptor {
  switch (kind) {
    case "tick.started":
    case "tick.queued":
      return {
        category: "tick",
        icon: "↻",
        title: "Tick",
        meta: asString(p["trigger"]) ?? "",
      };
    case "tick.completed":
      return {
        category: "tick",
        icon: "↻",
        title: "Tick completed",
        body: asRecord(p["report"])?.["changes"],
      };
    case "tick.failed":
      return {
        category: "error",
        icon: "↻",
        title: "Tick failed",
        text: asString(p["error"]) ?? "",
      };
    case "fleet.change":
      return {
        category: "change",
        icon: "•",
        title: asString(p["change"]) ?? "change",
      };
    default:
      return { category: "muted", icon: "◍", title: "Fleet snapshot" };
  }
}

function describeMaster(kind: string, p: Payload): Descriptor {
  switch (kind) {
    case "master.turn.started":
      return {
        category: "chat",
        icon: "🧑",
        title: "You",
        text: asString(p["prompt"]) ?? "",
        body: p["messages"],
      };
    case "master.turn.failed":
      return {
        category: "error",
        icon: "🤖",
        title: "Master turn failed",
        text: asString(p["error"]) ?? "",
      };
    default:
      return {
        category: "chat",
        icon: "🤖",
        title: "Master",
        text: asString(p["text"]) ?? asString(p["response"]) ?? "",
      };
  }
}

function describeWorker(kind: string, p: Payload): Descriptor {
  switch (kind) {
    case "worker.started":
      return {
        category: "worker",
        icon: "◆",
        title: "Worker started",
        body: p,
      };
    case "worker.attempt.started":
      return {
        category: "model",
        icon: "▸",
        title: `Model turn ${num(p["attempt"])}`,
        text: asString(p["prompt"]) ?? "",
      };
    case "worker.attempt.completed":
      return {
        category: "model",
        icon: "▸",
        title: `Model turn ${num(p["attempt"])} result`,
        body: p["result"],
      };
    case "worker.attempt.failed":
      return {
        category: "error",
        icon: "▸",
        title: `Model turn ${num(p["attempt"])} failed`,
        text: asString(p["error"]) ?? "",
      };
    case "worker.completed":
      return {
        category: "worker",
        icon: "◆",
        title: `Worker → ${asString(asRecord(p["result"])?.["state"]) ?? "done"}`,
        body: p["result"],
      };
    case "worker.cancelled":
      return {
        category: "muted",
        icon: "◆",
        title: "Worker cancelled",
        text: asString(p["reason"]) ?? "",
      };
    default:
      return {
        category: "error",
        icon: "◆",
        title: "Worker failed",
        text: asString(p["error"]) ?? "",
      };
  }
}

function describeToolCommand(kind: string, p: Payload): Descriptor {
  switch (kind) {
    case "tool.started":
      return {
        category: "tool",
        icon: "→",
        title: `tool: ${asString(p["tool"]) ?? "?"}`,
        body: p["input"],
      };
    case "tool.completed":
      return {
        category: "tool",
        icon: "✓",
        title: `tool: ${asString(p["tool"]) ?? "?"}`,
        body: p["result"],
      };
    case "tool.failed":
      return {
        category: "error",
        icon: "→",
        title: `tool: ${asString(p["tool"]) ?? "?"} failed`,
        text: asString(p["error"]) ?? "",
      };
    case "command.started":
      return {
        category: "cmd",
        icon: "$",
        title: commandLine(p["executable"], p["args"]),
        meta: asString(p["cwd"]) ?? "",
      };
    case "command.completed":
      return {
        category: p["exitCode"] === 0 ? "cmd" : "error",
        icon: "$",
        title: `exit ${num(p["exitCode"])} · ${num(p["durationMs"])}ms`,
        body: { stdout: p["stdout"], stderr: p["stderr"] },
      };
    case "command.failed":
      return {
        category: "error",
        icon: "$",
        title: `${asString(p["executable"]) ?? "command"} failed`,
        text: asString(p["error"]) ?? "",
      };
    default:
      return {
        category: "evidence",
        icon: "◈",
        title: `evidence: ${asString(p["operation"]) ?? "?"}`,
        body: p,
      };
  }
}

function describeEvent(event: RecordedRunEvent): Descriptor {
  const k = event.kind;
  const p = event.payload;
  if (
    k === "controller.initialized" ||
    k === "operator.input" ||
    k.startsWith("run.") ||
    k.startsWith("shutdown.")
  ) {
    return describeLifecycle(k, p);
  }
  if (k.startsWith("tick.") || k.startsWith("fleet.")) {
    return describeTick(k, p);
  }
  if (k.startsWith("master.")) {
    return describeMaster(k, p);
  }
  if (k.startsWith("worker.")) {
    return describeWorker(k, p);
  }
  if (
    k === "environment.result" ||
    k.startsWith("tool.") ||
    k.startsWith("command.")
  ) {
    return describeToolCommand(k, p);
  }
  return { category: "muted", icon: "·", title: k, body: p };
}

function describeSpan(span: SpanRecord): Descriptor {
  switch (span.type) {
    case "model_generation":
    case "model_step":
    case "model_inference":
      return {
        category: "reasoning",
        icon: "🧠",
        title: span.name || "model reasoning",
        body: {
          input: span.input,
          output: span.output,
          attributes: span.attributes,
        },
      };
    case "tool_call":
    case "mcp_tool_call":
      return {
        category: "tool",
        icon: "🔧",
        title: `span: ${span.name}`,
        body: { input: span.input, output: span.output },
      };
    case "agent_run":
      return {
        category: "model",
        icon: "◆",
        title: `agent: ${span.entityName ?? span.name}`,
      };
    default:
      return { category: "muted", icon: "◦", title: span.name, body: span };
  }
}

export function describe(item: TimelineItem): Descriptor {
  return item.kind === "event"
    ? describeEvent(item.event)
    : describeSpan(item.span);
}
