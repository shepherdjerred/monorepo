import { Link } from "@tanstack/react-router";
import { useId } from "react";
import type {
  PipelineAction,
  PipelineStage,
  Transition,
} from "#shared/hub/hub-contract.ts";
import { Status } from "#client/components/status.tsx";
import { Duration, RelativeTime } from "#client/components/time.tsx";
import { ShortSha, TargetLink, ToolLinks } from "#client/components/links.tsx";
import { stageSummary } from "./pipeline-view-model.ts";

function transitionLabel(transition: Transition) {
  if (!transition.enabled) return "Disabled for this environment";
  switch (transition.mode) {
    case "automatic": {
      return "Automatic";
    }
    case "manual": {
      return "On request";
    }
    case "promotion": {
      return "Promotion";
    }
    case "approval": {
      return "Approval required";
    }
  }
}

export function TransitionMarker({ transition }: { transition: Transition }) {
  return (
    <div
      className={`transition transition-${transition.enabled ? transition.mode : "disabled"}`}
    >
      <span className="transition-arrow" aria-hidden="true" />
      <span className="transition-label">{transitionLabel(transition)}</span>
    </div>
  );
}

function ActionRow({ action }: { action: PipelineAction }) {
  return (
    <li className={`action action-${action.status}`}>
      <Status value={action.status} />
      <div className="action-body">
        <strong>
          {action.target === null ? (
            action.title
          ) : (
            <TargetLink target={action.target}>{action.title}</TargetLink>
          )}
        </strong>
        {action.detail !== null && <p>{action.detail}</p>}
        <p className="action-meta">
          {action.startedAt !== null && (
            <Duration start={action.startedAt} end={action.finishedAt} />
          )}
          {action.startedAt === null && action.finishedAt !== null && (
            <RelativeTime value={action.finishedAt} />
          )}
        </p>
        <ToolLinks links={action.links} />
      </div>
    </li>
  );
}

function Revision({ stage }: { stage: PipelineStage }) {
  const execution = stage.execution;
  if (execution === null) return null;
  const label = (
    <>
      {execution.revision !== null && `r${String(execution.revision)} · `}
      {execution.sourceRevision === null ? (
        "composed"
      ) : (
        <ShortSha sha={execution.sourceRevision} />
      )}
    </>
  );
  return (
    <p className="stage-revision">
      {execution.buildId === null ? (
        execution.versionSetId === null ? (
          label
        ) : (
          <TargetLink
            target={{ kind: "versionSet", id: execution.versionSetId }}
          >
            {label}
          </TargetLink>
        )
      ) : (
        <TargetLink target={{ kind: "build", id: execution.buildId }}>
          {label}
        </TargetLink>
      )}
    </p>
  );
}

export function StageCard({ stage }: { stage: PipelineStage }) {
  const heading = useId();
  return (
    <section
      className={`stage-card stage-${stage.status}`}
      aria-labelledby={heading}
    >
      <header className="stage-header">
        <h3 id={heading}>
          {stage.environmentId === null ? (
            stage.title
          ) : (
            <Link to="/environments/$" params={{ _splat: stage.environmentId }}>
              {stage.title}
            </Link>
          )}
        </h3>
        <Status value={stage.status} />
      </header>
      <Revision stage={stage} />
      <p className="stage-summary">{stageSummary(stage)}</p>
      {stage.actions.length > 0 && (
        <ol className="actions" aria-label={`${stage.title} actions`}>
          {stage.actions.map((action) => (
            <ActionRow key={action.key} action={action} />
          ))}
        </ol>
      )}
      {stage.environmentId !== null &&
        stage.transition?.mode === "promotion" && (
          <Link
            className="text-button"
            to="/environments/$"
            params={{ _splat: stage.environmentId }}
            search={{ release: "promote" }}
          >
            Promote…
          </Link>
        )}
    </section>
  );
}
