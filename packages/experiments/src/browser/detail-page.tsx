import { Button, HeaderBar, Section } from "@shepherdjerred/console-ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import type {
  Experiment,
  ExperimentEvent,
  ExperimentPlan,
} from "@shepherdjerred/experiments/contract";
import { experimentDetailQuery } from "./api.ts";
import { ACTIONS, ActionCard, type DetailAction } from "./detail-actions.tsx";
import {
  DECISIONS,
  EXPERIMENTS_PATH,
  PLAN_FIELDS,
  ExperimentStatus,
  ExperimentTime,
  LinkedReference,
  ReviewDate,
} from "./presentation.tsx";

function PlanDetails({ plan }: { readonly plan: ExperimentPlan }) {
  const populated = PLAN_FIELDS.filter(({ name }) => plan[name] !== "");
  if (populated.length === 0) return <p>No plan details yet.</p>;
  return (
    <dl className="experiments-plan">
      {populated.map(({ name, label }) => (
        <div key={name}>
          <dt>{label.replace(" (optional)", "")}</dt>
          <dd>{plan[name]}</dd>
        </div>
      ))}
    </dl>
  );
}

function EventContent({ event }: { readonly event: ExperimentEvent }) {
  switch (event.kind) {
    case "created":
      return <strong>Draft created</strong>;
    case "edited":
      return <strong>Draft edited</strong>;
    case "started":
      return <strong>Experiment started</strong>;
    case "amendment":
      return (
        <>
          <strong>Plan amended</strong>
          <p>{event.rationale}</p>
          <details>
            <summary>Amended plan</summary>
            <PlanDetails plan={event.plan} />
          </details>
        </>
      );
    case "link":
      return (
        <>
          <strong>Reference added</strong>
          <p>
            <LinkedReference link={event.link} />
          </p>
        </>
      );
    case "evidence": {
      const { flagChange } = event;
      return (
        <>
          <strong>Evidence added</strong>
          <p>{event.note}</p>
          {event.link !== undefined && (
            <p>
              <LinkedReference link={event.link} />
            </p>
          )}
          {flagChange !== undefined && (
            <details>
              <summary>Flag change · revision {flagChange.revision}</summary>
              <p>
                <LinkedReference
                  link={{
                    kind: "flag",
                    deployment: flagChange.deployment,
                    key: flagChange.key,
                  }}
                />
              </p>
              <dl className="experiments-plan">
                <div>
                  <dt>Before</dt>
                  <dd>{flagChange.before || "—"}</dd>
                </div>
                <div>
                  <dt>After</dt>
                  <dd>{flagChange.after || "—"}</dd>
                </div>
                <div>
                  <dt>Observed at</dt>
                  <dd>
                    <ExperimentTime date={flagChange.changedAt} />
                  </dd>
                </div>
              </dl>
            </details>
          )}
        </>
      );
    }
    case "review":
      return (
        <>
          <strong>{DECISIONS[event.outcome]}</strong>
          <p>{event.rationale}</p>
          {event.reviewDate !== undefined && (
            <p>
              New review date · <ReviewDate date={event.reviewDate} />
            </p>
          )}
        </>
      );
  }
}

function Timeline({ events }: { readonly events: readonly ExperimentEvent[] }) {
  return (
    <ol className="experiments-timeline">
      {events.toReversed().map((event) => (
        <li key={event.revision}>
          <div className="experiments-meta">
            {event.actor} · <ExperimentTime date={event.at} />
          </div>
          <EventContent event={event} />
        </li>
      ))}
    </ol>
  );
}

const DETAIL_ACTIONS = {
  draft: ["start", "edit", "link"],
  running: ["review", "evidence", "link", "amend"],
  decided: [],
} as const satisfies Readonly<
  Record<Experiment["status"], readonly DetailAction[]>
>;

function ExperimentDetail({
  api,
  experiment,
}: {
  readonly api: string;
  readonly experiment: Experiment;
}) {
  const [open, setOpen] = useState<{
    action: DetailAction;
    snapshot: Experiment;
  }>();
  const [notice, setNotice] = useState("");
  const actions = DETAIL_ACTIONS[experiment.status];

  return (
    <main id="main" className="experiments-page">
      <HeaderBar
        lead={
          <Link to={EXPERIMENTS_PATH} className="experiments-back">
            <ArrowLeftIcon aria-hidden="true" /> Experiments
          </Link>
        }
        title={experiment.title}
        focusOnMount
        meta={
          <span className="experiments-summary">
            <ExperimentStatus item={experiment} />
            <span>{experiment.owner}</span>
            {experiment.reviewDate !== null && (
              <span>
                Review · <ReviewDate date={experiment.reviewDate} />
              </span>
            )}
          </span>
        }
        actions={
          open === undefined && actions.length > 0
            ? actions.map((action, index) => (
                <Button
                  key={action}
                  type="button"
                  variant={index === 0 ? "primary" : "default"}
                  onClick={() => {
                    setNotice("");
                    setOpen({ action, snapshot: experiment });
                  }}
                >
                  {ACTIONS[action].title}
                </Button>
              ))
            : undefined
        }
      />
      {notice !== "" && (
        <p className="experiments-notice" role="status">
          {notice}
        </p>
      )}
      {open !== undefined && (
        <ActionCard
          api={api}
          experiment={open.snapshot}
          action={open.action}
          onSaved={() => {
            setNotice(ACTIONS[open.action].success);
            setOpen(undefined);
          }}
          onCancel={() => {
            setOpen(undefined);
          }}
        />
      )}
      <div className="ui-columns">
        <Section
          title={experiment.originalPlan === null ? "Plan" : "Current plan"}
        >
          <div className="ui-section-body">
            <PlanDetails plan={experiment.plan} />
            {experiment.originalPlan !== null && (
              <details>
                <summary>Original plan</summary>
                <p>
                  Original review date ·{" "}
                  <ReviewDate date={experiment.originalReviewDate} />
                </p>
                <PlanDetails plan={experiment.originalPlan} />
              </details>
            )}
          </div>
        </Section>
        <Section title="Activity">
          <div className="ui-section-body">
            <Timeline events={experiment.timeline} />
          </div>
        </Section>
      </div>
    </main>
  );
}

export function ExperimentDetailPage({ api }: { readonly api: string }) {
  const { id = "" } = useParams<"id">();
  const detail = useQuery(experimentDetailQuery(api, id));
  if (detail.data !== undefined)
    return <ExperimentDetail key={id} api={api} experiment={detail.data} />;
  return (
    <main id="main" className="experiments-page">
      <HeaderBar
        title="Experiment"
        lead={<Link to={EXPERIMENTS_PATH}>Back to experiments</Link>}
      />
      <div className="ui-section-body">
        {detail.isPending && <p role="status">Loading experiment…</p>}
        {detail.isError && (
          <div>
            <p role="alert">{detail.error.message}</p>
            <Button
              type="button"
              onClick={() => {
                void detail.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
