import { useState } from "react";
import {
  useMutation,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { z } from "zod";
import { CommandResultSchema } from "#shared/api.ts";
import { BundleReviewProtocolSchema } from "#shared/handoff/library-bundle.ts";
import type { BundleReviewListSchema } from "#shared/migration-handoff.ts";
import { queryClient, readApi, writeApi } from "#client/api.ts";
import { classNames } from "#client/ui/class-names.ts";
import { Button } from "#client/ui/button.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, Callout, LoadError } from "#client/ui/feedback.tsx";
import { CheckboxField } from "#client/ui/forms/field.tsx";
import { EmptyNote, Panel, SkeletonRows } from "#client/ui/panel.tsx";
import {
  Code,
  Decision,
  Facts,
  PickBox,
  TechnicalDetails,
} from "#client/ui/workflow.tsx";
import { LibraryBundleForm } from "#client/library-import/bundle-form.tsx";
import type { Captures } from "./captures.tsx";
import { ReviewFailure } from "./failure.tsx";
import { RecordList, RecordRow, recordName } from "./records.tsx";
import { REVIEW_STATUS, SOURCE_LABELS, when } from "./vocabulary.ts";
import styles from "./migration.module.css";

const cx = classNames(styles);

export type Reports = z.infer<typeof BundleReviewListSchema>;
type Report = z.infer<typeof BundleReviewProtocolSchema>;

/** One prepared library report, read in full. Shared by steps 3 and 4. */
export function useReport(id: string | null) {
  return useQuery({
    queryKey: ["migration", "bundles", id],
    enabled: id !== null,
    queryFn: async () => {
      if (id === null) throw new Error("No library report is chosen");
      return readApi(
        `/admin/migration/bundles/${id}`,
        BundleReviewProtocolSchema,
      );
    },
  });
}

/** Step 3: compare the movie and TV captures, then approve what to adopt. */
export function ReportsSection({
  captures,
  reports,
  selected,
  onSelect,
  actorId,
}: {
  captures: UseQueryResult<Captures>;
  reports: UseQueryResult<Reports>;
  selected: string | null;
  onSelect: (id: string) => void;
  actorId: string;
}) {
  return (
    <>
      <Panel
        id="report"
        title="3. Build and approve the library report"
        description={
          <p>
            The report compares your movie and TV captures with each other and
            with what Media already knows. It changes nothing: files stay where
            they are, and files still need fresh mount, checksum, and handoff
            proof before anything is adopted.
          </p>
        }
      >
        {captures.isPending && (
          <SkeletonRows label="Loading captures" rows={2} tall />
        )}
        {captures.data !== undefined && (
          <LibraryBundleForm
            captures={captures.data}
            actorId={actorId}
            onCreated={onSelect}
          />
        )}
        <h3>Reports you have built</h3>
        {reports.isPending && <SkeletonRows label="Loading reports" rows={2} />}
        {reports.error !== null && (
          <LoadError
            what="Library reports"
            error={reports.error}
            retry={() => {
              void reports.refetch();
            }}
          />
        )}
        {reports.data?.length === 0 && (
          <EmptyNote>
            No library report yet. Build one from a Radarr and a Sonarr capture
            above.
          </EmptyNote>
        )}
        {reports.data !== undefined && reports.data.length > 0 && (
          <DataList label="Library reports">
            {reports.data.map((report) => {
              const status = REVIEW_STATUS[report.status];
              return (
                <DataRow
                  key={report.id}
                  title={`Report built ${when(report.createdAt)}`}
                  detail={`Fingerprint ${report.reportHash.slice(0, 12)}`}
                  status={<Badge tone={status.tone}>{status.label}</Badge>}
                  actions={
                    <Button
                      aria-label={`Review the report built ${when(report.createdAt)}`}
                      aria-pressed={selected === report.id}
                      onClick={() => {
                        onSelect(report.id);
                      }}
                    >
                      {selected === report.id ? "Reviewing" : "Review"}
                    </Button>
                  }
                />
              );
            })}
          </DataList>
        )}
      </Panel>
      {selected !== null && (
        <ReportDetail key={selected} id={selected} actorId={actorId} />
      )}
    </>
  );
}

function ReportDetail({ id, actorId }: { id: string; actorId: string }) {
  const [notice, setNotice] = useState<string | null>(null);
  const detail = useReport(id);
  if (detail.isPending) {
    return (
      <Panel title="Library report review">
        <SkeletonRows label="Loading the report" rows={4} tall />
      </Panel>
    );
  }
  if (detail.error !== null) {
    return (
      <Panel title="Library report review">
        <LoadError
          what="The library report"
          error={detail.error}
          retry={() => {
            void detail.refetch();
          }}
        />
      </Panel>
    );
  }
  return (
    <ReportReview
      key={`${id}:${String(detail.data.version)}`}
      review={detail.data}
      actorId={actorId}
      notice={notice}
      onRecorded={setNotice}
    />
  );
}

function ReportReview({
  review,
  actorId,
  notice,
  onRecorded,
}: {
  review: Report;
  actorId: string;
  notice: string | null;
  onRecorded: (message: string) => void;
}) {
  const [selected, setSelected] = useState(
    review.selection.map((item) => item.provenanceKey),
  );
  const entries = review.report.entries;
  const eligible = entries.filter(
    (entry) => entry.state === "adoptable_evidence_ready",
  ).length;
  const status = REVIEW_STATUS[review.status];
  const approved = review.status === "approved";
  const whole = review.manifest.complete && review.manifest.stable;
  return (
    <Panel
      id="report-review"
      title={`Library report built ${when(review.createdAt)}`}
    >
      <Callout tone={status.tone} title={status.label}>
        {whole
          ? "Complete, stable source set."
          : "Protected: source roles are missing or observations changed."}{" "}
        {status.meaning}
      </Callout>
      {notice !== null && (
        <Callout tone="ok">
          <span role="status">{notice}</span>
        </Callout>
      )}
      <Facts
        items={[
          { name: "Records", value: String(entries.length) },
          { name: "Evidence ready", value: String(eligible) },
          { name: "Selected for approval", value: String(selected.length) },
          {
            name: "Sources",
            value: review.manifest.captures
              .map((capture) => SOURCE_LABELS[capture.sourceKind])
              .join(", "),
          },
        ]}
      />
      <section className={cx("subsection")}>
        <h3>Choose what to approve</h3>
        <p>
          Only records with evidence ready can be selected. Approving records
          the selection and nothing else. None of these records is owned yet.
          {approved && " Revoke the approval to change the selection."}
        </p>
        <RecordList
          entries={entries}
          label="Library report records"
          empty="This report holds no records."
          row={(entry) => (
            <RecordRow
              key={entry.provenanceKey}
              entry={entry}
              note="Review evidence only."
              name={
                <PickBox
                  checked={selected.includes(entry.provenanceKey)}
                  disabled={
                    entry.state !== "adoptable_evidence_ready" || approved
                  }
                  onChange={(checked) => {
                    setSelected(
                      checked
                        ? [...selected, entry.provenanceKey]
                        : selected.filter((key) => key !== entry.provenanceKey),
                    );
                  }}
                >
                  <span className="sr-only">Select </span>
                  {recordName(entry)}
                </PickBox>
              }
            />
          )}
        />
      </section>
      <TechnicalDetails>
        <p>
          Bundle hash <Code>{review.manifest.bundleHash}</Code>
        </p>
        <p>
          Report hash <Code>{review.report.reportHash}</Code>
        </p>
        <p>
          Recovery epoch {review.recoveryEpoch} (it changes when the household
          is restored from a backup), runtime version {review.runtimeVersion},
          review version {review.version}.
        </p>
        <ul>
          {review.manifest.captures.map((capture) => (
            <li key={capture.captureId}>
              {SOURCE_LABELS[capture.sourceKind]} capture{" "}
              <Code>{capture.captureHash}</Code>
            </li>
          ))}
        </ul>
      </TechnicalDetails>
      <ReportDecision
        review={review}
        selected={selected}
        actorId={actorId}
        onRecorded={onRecorded}
      />
    </Panel>
  );
}

/** Record or revoke the approval of the records chosen above. */
function ReportDecision({
  review,
  selected,
  actorId,
  onRecorded,
}: {
  review: Report;
  selected: readonly string[];
  actorId: string;
  onRecorded: (message: string) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const approved = review.status === "approved";
  const mutation = useMutation({
    mutationFn: async (action: "approve" | "revoke") =>
      writeApi({
        actorId,
        path: `/admin/migration/bundles/${review.id}/review`,
        schema: CommandResultSchema,
        body: {
          action,
          expectedVersion: review.version,
          reportHash: review.report.reportHash,
          bundleHash: review.manifest.bundleHash,
          recoveryEpoch: review.recoveryEpoch,
          runtimeVersion: review.runtimeVersion,
          acknowledgeNoOwnershipTransfer: true,
          selected: review.report.entries
            .filter((entry) => selected.includes(entry.provenanceKey))
            .map((entry) => ({
              provenanceKey: entry.provenanceKey,
              evidenceHash: entry.observationHash,
            })),
        },
      }),
    onSuccess: async (_result, action) => {
      onRecorded(
        action === "approve"
          ? "Selection approved. You can prepare files from it in step 4. No ownership was transferred."
          : "Selection approval revoked. Step 4 is closed until you approve a selection again.",
      );
      await queryClient.invalidateQueries({
        queryKey: ["migration", "bundles"],
      });
    },
  });
  let blocked: string | null = null;
  if (review.status === "protected")
    blocked = "This report is protected, so nothing in it can be approved.";
  else if (!approved && selected.length === 0)
    blocked = "Select at least one record to approve.";
  return (
    <>
      <Decision
        title={
          approved ? "Revoke the selection approval" : "Record your approval"
        }
      >
        <p>
          {approved
            ? "Revoking saves that this selection is no longer approved, which closes step 4. You can select and approve again."
            : "Approving only records this selection. It does not transfer ownership."}
        </p>
        <CheckboxField
          label="I understand that approval only records this selection and does not transfer ownership."
          checked={acknowledged}
          onChange={(event) => {
            setAcknowledged(event.currentTarget.checked);
          }}
        />
        {blocked !== null && <p className={cx("hint")}>{blocked}</p>}
        <div>
          <Button
            variant={approved ? "secondary" : "primary"}
            busy={mutation.isPending}
            disabled={!acknowledged || blocked !== null}
            onClick={() => {
              mutation.mutate(approved ? "revoke" : "approve");
            }}
          >
            {decisionLabel(approved, mutation.isPending)}
          </Button>
        </div>
      </Decision>
      {mutation.error !== null && (
        <ReviewFailure
          error={mutation.error}
          verb={mutation.variables === "revoke" ? "revocation" : "approval"}
          queryKey={["migration", "bundles"]}
        />
      )}
    </>
  );
}

function decisionLabel(approved: boolean, pending: boolean): string {
  if (approved)
    return pending ? "Revoking approval…" : "Revoke selection approval";
  return pending ? "Recording approval…" : "Record selection approval";
}
