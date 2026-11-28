import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router";
import type { IncidentDetail } from "#shared/contract.ts";
import {
  actingActor,
  incidentDetailQuery,
  incidentsKeys,
  IncidentsApiError,
  mutateIncident,
  viewerQuery,
} from "#client/api.ts";
import {
  AddLinkForm,
  ResolutionControls,
  StatusControl,
  UpdateComposer,
} from "#client/detail-actions.tsx";
import {
  CommandPanel,
  type ActionProps,
  type PageNotice,
  type RunCommand,
} from "#client/detail-command.tsx";
import {
  AffectedList,
  IncidentFacts,
  LinksList,
  SignalsTable,
  Timeline,
} from "#client/detail-sections.tsx";
import { KIND_LABEL } from "#client/format.ts";
import { useIncidentStream, useNow } from "#client/live.ts";
import { INCIDENTS_BASE_PATH } from "#client/paths.ts";
import { ActingAs, IncidentsHeading, LiveStatus, Notice } from "#client/ui.tsx";
import "./incidents.css";

/** Every command refetches afterwards; a stale revision refetches before the error surfaces. */
function useRunCommand(): RunCommand {
  const queryClient = useQueryClient();
  return useCallback<RunCommand>(
    async (name, input) => {
      try {
        return await mutateIncident(name, input);
      } catch (error: unknown) {
        if (
          error instanceof IncidentsApiError &&
          error.conflict?.code === "stale-revision"
        )
          await queryClient.invalidateQueries({ queryKey: incidentsKeys.all });
        throw error;
      } finally {
        void queryClient.invalidateQueries({ queryKey: incidentsKeys.all });
      }
    },
    [queryClient],
  );
}

export function IncidentDetailView({
  incident,
  props,
  notice,
}: {
  readonly incident: IncidentDetail;
  readonly props: ActionProps;
  readonly notice: PageNotice | null;
}): React.JSX.Element {
  return (
    <div className="inc-detail">
      {notice === null ? null : (
        <Notice tone={notice.tone}>{notice.text}</Notice>
      )}
      <div className="inc-detail-grid">
        <div className="inc-detail-main">
          <CommandPanel {...props} />
          <IncidentFacts incident={incident} nowMs={props.nowMs} />
          <section className="inc-panel" aria-labelledby="inc-work-title">
            <h2
              className="ui-section-title inc-panel-title"
              id="inc-work-title"
            >
              Work the incident
            </h2>
            <StatusControl {...props} />
            <UpdateComposer {...props} />
          </section>
          <Timeline incident={incident} nowMs={props.nowMs} />
        </div>
        <div className="inc-detail-side">
          <SignalsTable incident={incident} nowMs={props.nowMs} />
          <AffectedList incident={incident} nowMs={props.nowMs} />
          <LinksList incident={incident}>
            <AddLinkForm {...props} />
          </LinksList>
        </div>
      </div>
    </div>
  );
}

export function IncidentDetailPage(): React.JSX.Element {
  const { ref = "" } = useParams();
  const detail = useQuery(incidentDetailQuery(ref));
  const viewer = useQuery(viewerQuery());
  const stream = useIncidentStream(
    detail.data === undefined ? null : detail.data.identifier,
  );
  const nowMs = useNow();
  const run = useRunCommand();
  const [notice, setNotice] = useState<PageNotice | null>(null);
  const viewerValue = viewer.data ?? null;
  const actor = actingActor(viewerValue);
  const incident = detail.data;

  return (
    <main className="inc-page">
      <title>{`${incident?.identifier ?? ref} · Incidents · Hub`}</title>
      <Link className="back-link" to={INCIDENTS_BASE_PATH}>
        <ArrowLeftIcon aria-hidden="true" />
        Incidents
      </Link>
      {incident === undefined ? (
        <>
          <IncidentsHeading eyebrow="Incident" title={ref} />
          {detail.isError ? (
            <p className="error-state">
              {detail.error instanceof IncidentsApiError &&
              detail.error.code === "NOT_FOUND"
                ? `${ref} does not exist.`
                : `${ref} is unavailable: ${detail.error.message}`}
            </p>
          ) : (
            <p className="loading-state">Loading {ref}…</p>
          )}
        </>
      ) : (
        <>
          <IncidentsHeading
            eyebrow={`${KIND_LABEL[incident.kind]} · ${incident.identifier}`}
            title={incident.title}
            compact
          >
            <LiveStatus snapshot={stream} />
            <ResolutionControls
              incident={incident}
              actor={actor}
              nowMs={nowMs}
              run={run}
              report={setNotice}
            />
          </IncidentsHeading>
          <ActingAs viewer={viewerValue} actor={actor} />
          <IncidentDetailView
            incident={incident}
            notice={notice}
            props={{ incident, actor, nowMs, run, report: setNotice }}
          />
        </>
      )}
    </main>
  );
}
