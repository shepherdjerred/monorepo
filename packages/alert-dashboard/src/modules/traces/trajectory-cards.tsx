import { StatusGlyph } from "@shepherdjerred/console-ui";
import type {
  TrajectoryItem,
  TrajectoryMessage,
  TrajectoryMessagePart,
} from "@shepherdjerred/llm-observability/llm-traces";

import { statusPill } from "#client/ops/pages/cluster-page.tsx";
import { formatValue } from "#shared/ops-format";

import {
  formatTokenInt,
  formatUsdTrace,
  prettyPrintJson,
} from "./traces-format.ts";
import {
  CodexAgentBody,
  OpenAiDecisionBody,
} from "./trajectory-agent-cards.tsx";

const SHAPE_LABELS: Readonly<Record<TrajectoryItem["shape"], string>> = {
  "ai-sdk-chat": "AI SDK chat",
  "ai-sdk-embed": "Embeddings",
  "openai-decision": "OpenAI decision",
  "claude-agent": "Claude agent",
  "codex-agent": "Codex agent",
};

function ToolPartPreview({
  pill,
  callId,
  payloadJson,
}: {
  readonly pill: React.ReactNode;
  readonly callId: string | null;
  readonly payloadJson: string;
}): React.JSX.Element {
  return (
    <div className="preview">
      <div className="traces-pill-wrap">
        {pill}
        {callId === null ? null : (
          <code className="rep-mailbox-chip">{callId}</code>
        )}
      </div>
      <pre className="traces-preview-pre">{prettyPrintJson(payloadJson)}</pre>
    </div>
  );
}

function MessagePartView({
  part,
}: {
  readonly part: TrajectoryMessagePart;
}): React.JSX.Element {
  switch (part.kind) {
    case "text":
      return <p className="traces-msg-text">{part.text}</p>;
    case "reasoning":
      return (
        <div className="traces-reasoning">
          <strong>Reasoning: </strong>
          {part.text}
        </div>
      );
    case "tool-call":
      return (
        <ToolPartPreview
          pill={statusPill("info", "→", `Tool call · ${part.toolName}`)}
          callId={part.callId}
          payloadJson={part.argumentsJson}
        />
      );
    case "tool-result":
      return (
        <ToolPartPreview
          pill={statusPill(
            part.isError ? "error" : "ok",
            part.isError ? "✕" : "✓",
            `Tool result${part.toolName === null ? "" : ` · ${part.toolName}`}`,
          )}
          callId={part.callId}
          payloadJson={part.outputJson}
        />
      );
    case "json":
      return <pre className="traces-pre">{prettyPrintJson(part.json)}</pre>;
  }
}

function MessageCard({
  message,
  labelPrefix,
}: {
  readonly message: TrajectoryMessage;
  readonly labelPrefix?: string | undefined;
}): React.JSX.Element {
  const roleClass =
    message.role === "assistant"
      ? " traces-msg-assistant"
      : message.role === "tool"
        ? " traces-msg-tool"
        : "";
  return (
    <div className={`traces-msg${roleClass}`}>
      <div className="traces-msg-role">
        <span>
          {labelPrefix === undefined
            ? message.role
            : `${labelPrefix} · ${message.role}`}
        </span>
      </div>
      {message.parts.map((part, idx) => (
        <MessagePartView key={idx} part={part} />
      ))}
    </div>
  );
}

function AiSdkChatBody({
  item,
}: {
  readonly item: Extract<TrajectoryItem, { shape: "ai-sdk-chat" }>;
}): React.JSX.Element {
  return (
    <>
      {item.systemInstructions === null ? null : (
        <details className="query-raw traces-disclosure">
          <summary className="query-raw-summary">System instructions</summary>
          <pre className="traces-pre">{item.systemInstructions}</pre>
        </details>
      )}
      {item.toolsJson === null ? null : (
        <details className="query-raw traces-disclosure">
          <summary className="query-raw-summary">Tool definitions</summary>
          <pre className="traces-pre">{prettyPrintJson(item.toolsJson)}</pre>
        </details>
      )}
      <div className="traces-messages">
        {item.messages.map((msg, idx) => (
          <MessageCard key={`in-${String(idx)}`} message={msg} />
        ))}
        {item.outputMessages.map((msg, idx) => (
          <MessageCard
            key={`out-${String(idx)}`}
            message={msg}
            labelPrefix="output"
          />
        ))}
      </div>
    </>
  );
}

function AiSdkEmbedBody({
  item,
}: {
  readonly item: Extract<TrajectoryItem, { shape: "ai-sdk-embed" }>;
}): React.JSX.Element {
  return (
    <div className="traces-messages">
      <div className="traces-pill-wrap">
        <span className="visual-pill" data-sev="info">
          {`${String(item.inputCount)} input${item.inputCount === 1 ? "" : "s"}`}
        </span>
        {item.dimensions === null ? null : (
          <span className="visual-pill">
            {`${String(item.dimensions)} dimensions`}
          </span>
        )}
      </div>
      {item.inputPreviews.map((preview, idx) => (
        <div key={idx} className="traces-msg">
          <p className="traces-msg-text">{preview}</p>
        </div>
      ))}
    </div>
  );
}

function ClaudeAgentBody({
  item,
}: {
  readonly item: Extract<TrajectoryItem, { shape: "claude-agent" }>;
}): React.JSX.Element {
  return (
    <>
      <div className="traces-pill-wrap">
        {item.sessionId === null ? null : (
          <code className="rep-mailbox-chip">{`session: ${item.sessionId}`}</code>
        )}
        {item.numTurns === null ? null : (
          <span className="visual-pill" data-sev="info">
            {`${String(item.numTurns)} turns`}
          </span>
        )}
        {item.notionalCostUsd === null ? null : (
          <span className="visual-pill">
            {`Subscription est. ${formatUsdTrace(item.notionalCostUsd)}`}
          </span>
        )}
      </div>
      {item.optionsJson === null ? null : (
        <details className="query-raw traces-disclosure">
          <summary className="query-raw-summary">
            Claude agent SDK options
          </summary>
          <pre className="traces-pre">{prettyPrintJson(item.optionsJson)}</pre>
        </details>
      )}
      {item.prompt === "" ? null : (
        <div className="traces-msg">
          <div className="traces-msg-role">
            <span>prompt</span>
          </div>
          <p className="traces-msg-text">{item.prompt}</p>
        </div>
      )}
      <div className="traces-messages">
        {item.assistantTurns.map((turn, idx) => (
          <MessageCard
            key={idx}
            message={turn}
            labelPrefix={`turn ${String(idx + 1)}`}
          />
        ))}
      </div>
    </>
  );
}

function StepBody({
  item,
}: {
  readonly item: TrajectoryItem;
}): React.JSX.Element {
  switch (item.shape) {
    case "ai-sdk-chat":
      return <AiSdkChatBody item={item} />;
    case "ai-sdk-embed":
      return <AiSdkEmbedBody item={item} />;
    case "openai-decision":
      return <OpenAiDecisionBody item={item} />;
    case "claude-agent":
      return <ClaudeAgentBody item={item} />;
    case "codex-agent":
      return <CodexAgentBody item={item} />;
  }
}

export function TrajectoryCard({
  item,
  index,
}: {
  readonly item: TrajectoryItem;
  readonly index: number;
}): React.JSX.Element {
  const modelName = item.responseModel ?? item.requestedModel;
  const isRepair = item.shape === "ai-sdk-chat" && item.isRepairAttempt;

  return (
    <article className="panel traces-step-card">
      <header className="traces-step-header">
        <div className="traces-pill-wrap">
          <span className="visual-pill" data-sev="info">
            {SHAPE_LABELS[item.shape]}
          </span>
          <h3 className="traces-step-title">
            {`${String(index + 1)}. ${item.workload ?? item.spanName}`}
          </h3>
          {isRepair ? statusPill("warning", "!", "Repair attempt") : null}
          {item.status === "error" ? <StatusGlyph severity="error" /> : null}
        </div>
        <div className="traces-pill-wrap">
          <span className="visual-pill">{item.provider}</span>
          {modelName === null ? null : (
            <code className="rep-mailbox-chip">{modelName}</code>
          )}
          <span className="mono traces-short-id">
            {`${formatTokenInt(item.inputTokens)} in · ${formatTokenInt(item.outputTokens)} out`}
          </span>
          <span className="mono traces-short-id">
            {formatValue(item.durationMs, "ms")}
          </span>
          {item.costKind === "subscription" ? (
            <span className="visual-pill">Subscription est.</span>
          ) : item.catalogCostUsd === null ? null : (
            <span className="mono traces-short-id">
              {formatUsdTrace(item.catalogCostUsd)}
            </span>
          )}
        </div>
      </header>

      {item.errorMessage === null ? null : (
        <div className="eng-callout" data-sev="error">
          <div className="eng-callout-body">
            <p className="eng-callout-title">{item.errorMessage}</p>
          </div>
        </div>
      )}

      <StepBody item={item} />
    </article>
  );
}
