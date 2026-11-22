import { LibraryBatch } from "#client/library-import/batch.tsx";
import { LoadError } from "#client/ui/feedback.tsx";
import { EmptyNote, Panel, SkeletonRows } from "#client/ui/panel.tsx";
import { useReport } from "./reports.tsx";
import { REVIEW_STATUS } from "./vocabulary.ts";

/** Step 4: choose the files of the approved report to prepare for adoption. */
export function PrepareSection({
  reportId,
  actorId,
}: {
  reportId: string | null;
  actorId: string;
}) {
  const report = useReport(reportId);
  return (
    <Panel
      id="prepare"
      title="4. Prepare files for adoption"
      description={
        <p>
          Pick up to 25 files from the approved report. Media checks their
          current bytes and Plex identity, then writes down exactly what
          adoption would change. Preparing changes nothing.
        </p>
      }
    >
      {reportId === null && (
        <EmptyNote>
          Choose a library report in step 3 and approve a selection to prepare
          files from it.
        </EmptyNote>
      )}
      {reportId !== null && report.isPending && (
        <SkeletonRows label="Loading the report" rows={3} tall />
      )}
      {report.error !== null && (
        <LoadError
          what="The library report"
          error={report.error}
          retry={() => {
            void report.refetch();
          }}
        />
      )}
      {report.data !== undefined && report.data.status !== "approved" && (
        <EmptyNote>
          The chosen report is{" "}
          {REVIEW_STATUS[report.data.status].label.toLowerCase()}. Approve a
          selection in step 3 to prepare files from it.
        </EmptyNote>
      )}
      {report.data?.status === "approved" && (
        <LibraryBatch
          key={`${report.data.id}:${String(report.data.version)}`}
          review={report.data}
          actorId={actorId}
        />
      )}
    </Panel>
  );
}
