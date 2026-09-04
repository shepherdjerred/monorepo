import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { ChallengeProgress } from "#src/components/challenge-progress.tsx";
import { ChallengeAccountEditor } from "#src/components/challenge-account-editor.tsx";
import { useChallengeRunParams } from "#src/lib/route-params.ts";
import { useTRPC } from "#src/lib/trpc.ts";

export function ChallengeRun() {
  const { runId } = useChallengeRunParams();
  const trpc = useTRPC();
  const run = useQuery(
    trpc.challenge.getRun.queryOptions({ runId }, { refetchInterval: 5000 }),
  );
  if (run.isPending)
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-scout-subtle">
        Loading run…
      </div>
    );
  if (run.isError)
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 text-sm text-scout-danger">
        {run.error.message}
      </div>
    );
  const snapshot = run.data.currentSnapshot;
  const latestRevision = run.data.revisions[0];
  if (latestRevision === undefined) {
    throw new Error("Challenge run has no evaluation revision");
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:py-12">
      <Link
        to="/challenges"
        className="text-sm text-scout-subtle hover:underline"
      >
        ← Challenges
      </Link>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {run.data.title}
          </h1>
          <Badge variant="outline">
            {run.data.recomputing ? "recomputing" : run.data.status}
          </Badge>
        </div>
        <p className="text-scout-subtle">{run.data.summary}</p>
        <p className="text-sm">
          Started {new Date(run.data.originalStartAt).toLocaleString()}
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
          <CardDescription>
            {run.data.recomputing
              ? "Showing the last complete snapshot while revision work continues."
              : "Deterministically evaluated from Scout's retained match evidence."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {snapshot === null ? (
            <p className="text-sm text-scout-subtle">
              The first snapshot is still building.
            </p>
          ) : (
            <div className="space-y-4">
              <ChallengeProgress progress={snapshot.progress} />
              <p className="text-sm text-scout-subtle">
                Evaluated {snapshot.coverage.evaluatedMatchCount.toString()}{" "}
                matches. Missing timeline evidence:{" "}
                {snapshot.coverage.missingTimelineEvidence.toString()}. Period
                begins{" "}
                {new Date(
                  snapshot.coverage.selectedPeriod.startAt,
                ).toLocaleString()}
                .
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      {run.data.canManage ? (
        <ChallengeAccountEditor
          runId={runId}
          runStatus={run.data.status}
          selectedAccounts={latestRevision.accounts}
        />
      ) : null}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Evaluation history</h2>
        <ul className="space-y-1 text-sm text-scout-subtle">
          {run.data.revisions.map((revision) => (
            <li key={revision.revision}>
              Revision {revision.revision.toString()} · {revision.state}
              {revision.errorMessage === null
                ? ""
                : ` · ${revision.errorMessage}`}
            </li>
          ))}
        </ul>
      </section>
      <Button asChild variant="outline">
        <Link to={`/challenges/${run.data.templateId}`}>Start a new run</Link>
      </Button>
    </div>
  );
}
