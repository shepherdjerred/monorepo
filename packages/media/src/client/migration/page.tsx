import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import { MigrationProposalListSchema } from "#shared/migration.ts";
import { BundleReviewListSchema } from "#shared/migration-handoff.ts";
import { readApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { LibraryPlan } from "#client/library-import/plan.tsx";
import { StepList, type Step } from "#client/ui/workflow.tsx";
import { CapturesSection, type Captures } from "./captures.tsx";
import { PrepareSection } from "./prepare.tsx";
import { ReportsSection, type Reports } from "./reports.tsx";
import { UploadCapture } from "./upload.tsx";

function count<Row extends { status: string }>(
  rows: readonly Row[] | undefined,
  status: Row["status"],
) {
  return (rows ?? []).filter((row) => row.status === status).length;
}

/** A step that waits on the owner while something is to review, and is done once something is approved. */
function reviewStep(
  step: Pick<Step, "to" | "title">,
  toReview: number,
  approved: number,
  nothing: string,
): Step {
  if (toReview > 0)
    return { ...step, state: `${String(toReview)} to review`, tone: "warn" };
  return approved > 0
    ? { ...step, state: `${String(approved)} approved`, tone: "ok" }
    : { ...step, state: nothing, tone: "neutral" };
}

/** Where each step stands, from what Media holds. */
function stepsFor(
  captures: Captures | undefined,
  reports: Reports | undefined,
  handoff: string | null,
): Step[] {
  const saved = captures?.length ?? 0;
  return [
    {
      to: "#capture",
      title: "Add a capture",
      state: saved === 0 ? "Not started" : `${String(saved)} saved`,
      tone: saved === 0 ? "neutral" : "ok",
    },
    reviewStep(
      { to: "#captures", title: "Review captures" },
      count(captures, "awaiting_review"),
      count(captures, "approved"),
      "Nothing to review",
    ),
    reviewStep(
      { to: "#report", title: "Library report" },
      count(reports, "awaiting_review"),
      count(reports, "approved"),
      "Not built",
    ),
    {
      to: "#prepare",
      title: "Prepare files",
      state:
        count(reports, "approved") > 0
          ? "Ready"
          : "Waiting for an approved report",
      tone: "neutral",
    },
    {
      to: "#adopt",
      title: "Review and adopt",
      state: handoff === null ? "No plan open" : "Plan open",
      tone: handoff === null ? "neutral" : "warn",
    },
  ];
}

/**
 * The owner's migration from the existing managers, as one staged process:
 * capture, review, compare, prepare, adopt. Only the last step records
 * ownership, and it asks first.
 */
export function MigrationPage({ user }: { user: MediaUser }) {
  const [capture, setCapture] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [params] = useSearchParams();
  const handoff = params.get("handoff");
  const captures = useQuery({
    queryKey: ["migration"],
    queryFn: async () =>
      readApi("/admin/migration", MigrationProposalListSchema),
  });
  const reports = useQuery({
    queryKey: ["migration", "bundles"],
    queryFn: async () =>
      readApi("/admin/migration/bundles", BundleReviewListSchema),
  });
  return (
    <>
      <PageTitle title="Migration">
        <p>
          Bring your existing library across from Radarr, Sonarr, and your other
          managers, one checked step at a time. Every source record stays
          unowned until the last step, which asks you to confirm.
        </p>
      </PageTitle>
      <StepList
        label="Migration steps"
        steps={stepsFor(captures.data, reports.data, handoff)}
      />
      <UploadCapture actorId={user.id} onSaved={setCapture} />
      <CapturesSection
        captures={captures}
        selected={capture}
        onSelect={setCapture}
        user={user}
      />
      <ReportsSection
        captures={captures}
        reports={reports}
        selected={report}
        onSelect={setReport}
        actorId={user.id}
      />
      <PrepareSection reportId={report} actorId={user.id} />
      <LibraryPlan id={handoff} actorId={user.id} />
    </>
  );
}
