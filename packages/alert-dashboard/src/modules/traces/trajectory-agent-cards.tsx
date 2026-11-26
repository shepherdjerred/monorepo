import type {
  TrajectoryDecisionAnswer,
  TrajectoryItem,
} from "@shepherdjerred/ops-model/llm-traces.ts";

import { statusPill } from "#client/ops/pages/cluster-page.tsx";
import { BudgetMeter } from "#client/visuals/index.ts";
import { formatValue } from "#shared/ops-format";

import { formatTokenInt, prettyPrintJson } from "./traces-format.ts";

function ProbabilityMeters({
  prefix,
  probabilities,
}: {
  readonly prefix: string;
  readonly probabilities: readonly {
    readonly label: string;
    readonly probability: number;
  }[];
}): React.JSX.Element {
  return (
    <>
      {probabilities.map((opt) => (
        <BudgetMeter
          key={opt.label}
          label={`${prefix}${opt.label}`}
          value={opt.probability}
          max={1}
          unit="ratio"
          severity="info"
        />
      ))}
    </>
  );
}

function ConfidenceCaption({
  name,
  confidence,
}: {
  readonly name: string;
  readonly confidence: number;
}): React.JSX.Element {
  return (
    <>
      <code className="rep-mailbox-chip">{name}</code>
      <span className="traces-short-id mono">
        {`${String(Math.round(confidence * 100))}% conf`}
      </span>
    </>
  );
}

function DecisionAnswerCard({
  answer,
}: {
  readonly answer: TrajectoryDecisionAnswer;
}): React.JSX.Element {
  switch (answer.type) {
    case "predicate":
      return (
        <div className="traces-decision-card">
          <div className="traces-pill-wrap">
            <span className="visual-pill" data-sev="info">
              Predicate
            </span>
            <code className="rep-mailbox-chip">{answer.name}</code>
          </div>
          <BudgetMeter
            label={`${answer.name} probability`}
            value={answer.probability}
            max={1}
            unit="ratio"
            severity="info"
            detail="Calibrated predicate probability"
          />
        </div>
      );
    case "choice":
      return (
        <div className="traces-decision-card">
          <div className="traces-pill-wrap">
            <span className="visual-pill" data-sev="ok">
              {`Choice · ${answer.choice}`}
            </span>
            <ConfidenceCaption
              name={answer.name}
              confidence={answer.confidence}
            />
          </div>
          <ProbabilityMeters
            prefix={`${answer.name}: `}
            probabilities={answer.probabilities}
          />
        </div>
      );
    case "score":
      return (
        <div className="traces-decision-card">
          <div className="traces-pill-wrap">
            <span className="visual-pill" data-sev="info">
              {`Score · ${answer.score.toFixed(2)}`}
            </span>
            <ConfidenceCaption
              name={answer.name}
              confidence={answer.confidence}
            />
          </div>
          <ProbabilityMeters
            prefix={`${answer.name} bucket `}
            probabilities={answer.probabilities}
          />
        </div>
      );
    case "refusal":
      return (
        <div className="traces-decision-card">
          <div className="traces-pill-wrap">
            {statusPill("warning", "!", "Refusal")}
            <code className="rep-mailbox-chip">{answer.name}</code>
          </div>
        </div>
      );
  }
}

export function OpenAiDecisionBody({
  item,
}: {
  readonly item: Extract<TrajectoryItem, { shape: "openai-decision" }>;
}): React.JSX.Element {
  return (
    <>
      {item.systemInstructions === null ? null : (
        <details className="query-raw traces-disclosure">
          <summary className="query-raw-summary">Decision instructions</summary>
          <pre className="traces-pre">{item.systemInstructions}</pre>
        </details>
      )}
      <details className="query-raw traces-disclosure">
        <summary className="query-raw-summary">Decision input JSON</summary>
        <pre className="traces-pre">
          {prettyPrintJson(item.decisionInputJson)}
        </pre>
      </details>
      <details className="query-raw traces-disclosure">
        <summary className="query-raw-summary">Questions schema JSON</summary>
        <pre className="traces-pre">{prettyPrintJson(item.questionsJson)}</pre>
      </details>
      <div className="traces-decisions-grid">
        {item.answers.map((ans) => (
          <DecisionAnswerCard key={`${ans.type}-${ans.name}`} answer={ans} />
        ))}
      </div>
    </>
  );
}

export function CodexAgentBody({
  item,
}: {
  readonly item: Extract<TrajectoryItem, { shape: "codex-agent" }>;
}): React.JSX.Element {
  return (
    <div className="traces-messages">
      {item.turns.map((turn) => (
        <div key={turn.spanId} className="traces-msg traces-msg-assistant">
          <div className="traces-msg-role">
            <span>{`Turn ${String(turn.turnIndex)}`}</span>
            <span>{`${formatTokenInt(turn.inputTokens)} in · ${formatTokenInt(turn.outputTokens)} out`}</span>
          </div>
          {turn.prompt === null ? null : (
            <p className="traces-msg-text">{turn.prompt}</p>
          )}
          {turn.assistantMessages.map((text, idx) => (
            <p key={idx} className="traces-msg-text">
              {text}
            </p>
          ))}
        </div>
      ))}
      {item.commands.map((cmd) => {
        const exitOk = cmd.exitCode === 0;
        const exitText =
          cmd.exitCode === null ? "exit —" : `exit ${String(cmd.exitCode)}`;
        return (
          <div key={cmd.spanId} className="preview traces-cmd-card">
            <div className="traces-cmd-head">
              <code className="traces-cmd-code">{cmd.command}</code>
              <div className="traces-pill-wrap">
                {statusPill(
                  exitOk ? "ok" : "error",
                  exitOk ? "✓" : "✕",
                  exitText,
                )}
                <span className="mono traces-short-id">
                  {formatValue(cmd.durationMs, "ms")}
                </span>
              </div>
            </div>
            {cmd.stdout === "" ? null : (
              <div>
                <span className="traces-msg-role">stdout</span>
                <pre className="traces-preview-pre">{cmd.stdout}</pre>
              </div>
            )}
            {cmd.stderr === "" ? null : (
              <div>
                <span className="traces-msg-role">stderr</span>
                <pre className="traces-preview-pre">{cmd.stderr}</pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
