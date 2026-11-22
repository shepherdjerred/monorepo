import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { RotateCwIcon } from "lucide-react";
import type { z } from "zod";
import {
  ApplyLibraryHandoffV3Schema,
  FinishedLibraryHandoffV3Schema,
} from "#shared/handoff/library-v3.ts";
import type { LibrarySeriesMonitoringV1Schema } from "#shared/handoff/library-v3.ts";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
} from "#shared/movie-editions/registry.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { queryClient, writeApi } from "#client/api.ts";
import { Button } from "#client/ui/button.tsx";
import { ConfirmDialog } from "#client/ui/confirm-dialog.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, Callout, LoadError } from "#client/ui/feedback.tsx";
import { CheckboxField } from "#client/ui/forms/field.tsx";
import { EmptyNote, Panel, SkeletonRows } from "#client/ui/panel.tsx";
import {
  ActionFailure,
  Code,
  Decision,
  Facts,
  TechnicalDetails,
} from "#client/ui/workflow.tsx";
import { reasonLabel, when } from "#client/migration/vocabulary.ts";
import { useHandoffPlan, type HandoffPlanDetailSchema } from "./plan-detail.ts";

type Detail = z.infer<typeof HandoffPlanDetailSchema>;
type State = Detail["state"];

const PLAN_STATE = {
  preparing: {
    label: "Being prepared",
    tone: "neutral",
    meaning:
      "Workers are checking the files, subtitles, mounts, and Plex identity. Ownership is unchanged, and this page updates itself.",
  },
  awaiting_review: {
    label: "Needs your approval",
    tone: "warn",
    meaning:
      "Nothing has been adopted. Check the changes below, then approve them.",
  },
  applying: {
    label: "Being adopted",
    tone: "neutral",
    meaning: "Your approval is queued and its checks run in the background.",
  },
  applied: {
    label: "Adopted",
    tone: "ok",
    meaning:
      "The files are adopted and the Plex labels are corrected. Recovery holds stay in effect.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "danger",
    meaning:
      "This plan was cancelled and nothing was adopted. Prepare a new batch in step 4.",
  },
} satisfies Record<
  State,
  { label: string; tone: "neutral" | "ok" | "warn" | "danger"; meaning: string }
>;

/** Step 5: the plan Media prepared, to read and then approve or leave alone. */
export function LibraryPlan({
  id,
  actorId,
}: {
  id: string | null;
  actorId: string;
}) {
  const detail = useHandoffPlan(id);
  return (
    <Panel
      id="adopt"
      title="5. Review and adopt files"
      description={
        <p>
          Existing files stay at their current paths. Movie cuts are assigned
          before ownership, and Plex edits keep the existing item and its watch
          state. Adopting is the one step here that records ownership and
          changes Plex labels, and it asks you to confirm.
        </p>
      }
    >
      {id === null && (
        <EmptyNote>
          No plan is open. Prepare files in step 4 and the plan opens here.
        </EmptyNote>
      )}
      {id !== null && detail.isPending && (
        <SkeletonRows label="Loading the plan" rows={4} tall />
      )}
      {id !== null && detail.error !== null && (
        <LoadError
          what="The adoption plan"
          error={detail.error}
          retry={() => {
            void detail.refetch();
          }}
        />
      )}
      {detail.data !== undefined && (
        <PlanReview
          key={`${detail.data.id}:${String(detail.data.version)}`}
          detail={detail.data}
          actorId={actorId}
        />
      )}
    </Panel>
  );
}

function PlanReview({ detail, actorId }: { detail: Detail; actorId: string }) {
  const scope = detail.scope;
  if (!("schemaVersion" in scope) || scope.schemaVersion !== 3)
    return (
      <Callout tone="warn" title="An earlier import protocol">
        This plan uses an earlier import protocol. Prepare a new file batch in
        step 4 to review automatic Plex label correction.
      </Callout>
    );
  return <CurrentPlan detail={detail} scope={scope} actorId={actorId} />;
}

type Scope = Extract<Detail["scope"], { schemaVersion: 3 }>;

function CurrentPlan({
  detail,
  scope,
  actorId,
}: {
  detail: Detail;
  scope: Scope;
  actorId: string;
}) {
  const plan =
    detail.plan === null
      ? null
      : FinishedLibraryHandoffV3Schema.parse(detail.plan);
  const expired =
    detail.expiresAt !== null && Date.parse(detail.expiresAt) <= Date.now();
  const labelChanges = plan?.plexEdits.length ?? 0;
  return (
    <>
      <PlanBanner detail={detail} expired={expired} />
      <Facts
        items={[
          { name: "Files", value: String(scope.files.length) },
          {
            name: "Plex label changes",
            value:
              plan === null
                ? "Waiting for the Plex check"
                : String(labelChanges),
          },
          { name: "Captions", value: String(scope.subtitles.length) },
          {
            name: "Subtitle policies",
            value: String(scope.subtitlePolicies.length),
          },
          {
            name: "Quality profile bindings",
            value: String(scope.request.profiles.length),
          },
          {
            name: "Review expires",
            value:
              detail.expiresAt === null
                ? "Not set yet"
                : when(detail.expiresAt),
          },
        ]}
      />
      <DataList label="Files in this plan">
        {scope.files.map((file) => (
          <PlanFile key={file.assetId} file={file} plan={plan} />
        ))}
      </DataList>
      <SeriesMonitoringReview policies={scope.request.seriesMonitoring ?? []} />
      {scope.protected.length > 0 && (
        <Callout tone="warn" title="Protected records">
          <ul>
            {scope.protected.map((item) => (
              <li key={item.provenanceKey}>{reasonLabel(item.reason)}</li>
            ))}
          </ul>
          These stay protected and are not part of this adoption.
        </Callout>
      )}
      <TechnicalDetails>
        <p>
          Review reference <Code>{detail.id}</Code>. Keep this page address to
          return to this plan.
        </p>
        <p>
          Plan hash <Code>{detail.planHash ?? "Not prepared yet"}</Code>
        </p>
        <p>
          Recovery epoch {scope.request.recoveryEpoch}, runtime version{" "}
          {scope.request.runtimeVersion}, review version {detail.version}.
        </p>
      </TechnicalDetails>
      {detail.state === "awaiting_review" && (
        <PlanApproval
          detail={detail}
          scope={scope}
          actorId={actorId}
          expired={expired}
          ready={plan !== null && detail.planHash !== null}
          labelChanges={labelChanges}
        />
      )}
    </>
  );
}

/** Where the plan stands, and why it cannot be approved if it cannot. */
function PlanBanner({ detail, expired }: { detail: Detail; expired: boolean }) {
  const state = PLAN_STATE[detail.state];
  const running = detail.state === "preparing" || detail.state === "applying";
  return (
    <>
      <Callout tone={state.tone} title={state.label}>
        {state.meaning}
        {running && (
          <>
            {" "}
            <Link to="/manage/activity">View activity</Link> for progress or
            failures.
          </>
        )}
      </Callout>
      {expired && detail.state === "awaiting_review" && (
        <Callout tone="warn" title="This review expired">
          It expired {when(detail.expiresAt ?? "")}. Nothing was adopted.
          Prepare a fresh batch in step 4.
        </Callout>
      )}
      {detail.receiptId !== null && (
        <Callout tone="ok">
          <span role="status">
            Adoption recorded. Receipt <Code>{detail.receiptId}</Code>.
          </span>
        </Callout>
      )}
    </>
  );
}

type PlanFileScope = Scope["files"][number];

function plexLabel(
  edit:
    | { beforeEditionTitle: string | null; targetEditionTitle: string }
    | undefined,
  prepared: boolean,
): string {
  if (edit === undefined)
    return prepared ? "No change planned" : "Awaiting the Plex check";
  const before = edit.beforeEditionTitle ?? "";
  return `${before === "" ? "Unmarked" : before} → ${edit.targetEditionTitle || "Unmarked"}`;
}

function PlanFile({
  file,
  plan,
}: {
  file: PlanFileScope;
  plan: z.infer<typeof FinishedLibraryHandoffV3Schema> | null;
}) {
  const edition = MovieEditionKeySchema.parse(file.edition);
  const edit = plan?.plexEdits.find((item) => item.assetId === file.assetId);
  const items = file.mediaIds.length;
  return (
    <DataRow
      title={<Code>{file.canonicalPath}</Code>}
      detail={
        <>
          <p>
            {file.libraryKind === "movies"
              ? `Cut: ${MOVIE_EDITION_REGISTRY[edition].displayLabel}`
              : "TV or anime episode mapping"}
            , {items} mapped item{items === 1 ? "" : "s"}
          </p>
          <p>Plex edition label: {plexLabel(edit, plan !== null)}</p>
        </>
      }
    />
  );
}

/** The acknowledgement, the button, and the confirmation that adopts the files. */
function PlanApproval({
  detail,
  scope,
  actorId,
  expired,
  ready,
  labelChanges,
}: {
  detail: Detail;
  scope: Scope;
  actorId: string;
  expired: boolean;
  ready: boolean;
  labelChanges: number;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const confirm = useRef<HTMLDialogElement>(null);
  const apply = useMutation({
    mutationFn: async () =>
      writeApi({
        actorId,
        path: `/admin/handoffs/${detail.id}/apply`,
        schema: CommandResultSchema,
        body: ApplyLibraryHandoffV3Schema.parse({
          schemaVersion: 3,
          expectedVersion: detail.version,
          planHash: detail.planHash,
          recoveryEpoch: detail.scope.request.recoveryEpoch,
          runtimeVersion: detail.scope.request.runtimeVersion,
          acknowledgeRecoveryHolds: true,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["library-plan", detail.id],
      });
    },
  });
  const monitoring = scope.request.seriesMonitoring?.length ?? 0;
  const files = scope.files.length;
  return (
    <>
      <Decision title="Approve this plan">
        <p>
          Adopting records Media as the owner of these files at their current
          paths and corrects the Plex edition labels listed above. This page
          cannot undo it.
        </p>
        <CheckboxField
          label="I approve these file classifications, Plex label changes, and selected series monitoring, and understand recovery holds remain in effect."
          checked={acknowledged}
          onChange={(event) => {
            setAcknowledged(event.currentTarget.checked);
          }}
        />
        <p>
          <Button
            variant="primary"
            busy={apply.isPending}
            disabled={!acknowledged || expired || !ready}
            onClick={() => {
              confirm.current?.showModal();
            }}
          >
            {apply.isPending
              ? "Submitting approval…"
              : "Adopt files and correct Plex labels"}
          </Button>
        </p>
      </Decision>
      <ConfirmDialog
        ref={confirm}
        title="Adopt these files?"
        confirmLabel="Adopt files"
        danger
        onConfirm={() => {
          apply.mutate();
        }}
      >
        <p>
          Media will be recorded as the owner of {files} file
          {files === 1 ? "" : "s"} at their current paths and will change{" "}
          {labelChanges} Plex edition label{labelChanges === 1 ? "" : "s"} in
          place
          {monitoring === 0
            ? "."
            : `, and will monitor ${String(monitoring)} series for future episodes.`}{" "}
          This page cannot undo it, and recovery holds stay in effect.
        </p>
      </ConfirmDialog>
      {apply.error !== null && (
        <ActionFailure
          title="The adoption was not submitted"
          error={apply.error}
          state="As far as this page can tell, nothing was adopted and the plan is unchanged. Refresh the plan to confirm."
          action={
            <Button
              onClick={() => {
                void queryClient.invalidateQueries({
                  queryKey: ["library-plan", detail.id],
                });
              }}
            >
              <RotateCwIcon aria-hidden="true" />
              Refresh the plan
            </Button>
          }
        />
      )}
    </>
  );
}

function SeriesMonitoringReview({
  policies,
}: {
  policies: z.infer<typeof LibrarySeriesMonitoringV1Schema>[];
}) {
  if (policies.length === 0) return null;
  return (
    <section>
      <h3>Series monitoring</h3>
      <p>
        Approving also turns on monitoring for later episodes with the captured
        quality profile. Existing episode overrides remain in effect.
      </p>
      <DataList label="Series to monitor">
        {policies.map((policy) => (
          <DataRow
            key={policy.seriesId}
            title={<Link to={`/media/${policy.seriesId}`}>{policy.title}</Link>}
            detail={`Future episodes, ${policy.includeSpecials ? "including specials" : "excluding specials"}`}
            status={<Badge>Monitoring</Badge>}
          />
        ))}
      </DataList>
    </section>
  );
}
