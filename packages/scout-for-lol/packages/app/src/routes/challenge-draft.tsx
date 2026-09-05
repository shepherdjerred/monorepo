import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { ChallengeProgress } from "#src/components/challenge-progress.tsx";
import { useChallengeDraftParams } from "#src/lib/route-params.ts";
import { useTRPC } from "#src/lib/trpc.ts";

export function ChallengeDraft() {
  const { draftId } = useChallengeDraftParams();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const draft = useQuery(trpc.challenge.getDraft.queryOptions({ draftId }));
  const publish = useMutation(
    trpc.challenge.publishDraft.mutationOptions({
      onSuccess: (version) => {
        void navigate(`/challenges/${version.templateId}`);
      },
      onError: (mutationError) => {
        setError(mutationError.message);
      },
    }),
  );

  if (draft.isPending) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-scout-subtle">
        Loading draft…
      </div>
    );
  }
  if (draft.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-scout-danger">
        {draft.error.message}
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:py-12">
      <Link to="/explore" className="text-sm text-scout-subtle hover:underline">
        ← Explore
      </Link>
      <header className="space-y-2">
        <p className="text-sm font-medium text-primary">Publication review</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {draft.data.contract.title}
        </h1>
        <p className="text-scout-subtle">{draft.data.contract.summary}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Canonical rules</CardTitle>
          <CardDescription>
            The typed contract below is frozen when this version is published.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">{draft.data.contract.explanation.join(" ")}</p>
          <pre className="max-h-80 overflow-auto rounded-md bg-scout-canvas p-3 text-xs">
            {JSON.stringify(draft.data.contract, null, 2)}
          </pre>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Historical preview</CardTitle>
          <CardDescription>
            Preview evidence is informative only and never becomes a run
            automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {draft.data.preview === null ? (
            <p className="text-sm text-scout-danger">
              Return to Explore and preview this draft before publishing it.
            </p>
          ) : (
            <div className="space-y-4">
              <ChallengeProgress progress={draft.data.preview.progress} />
              <p className="text-sm text-scout-subtle">
                Evaluated{" "}
                {draft.data.preview.coverage.evaluatedMatchCount.toString()}{" "}
                matches from{" "}
                {new Date(
                  draft.data.preview.coverage.selectedPeriod.startAt,
                ).toLocaleDateString()}{" "}
                to{" "}
                {new Date(
                  draft.data.preview.coverage.selectedPeriod.endAt ??
                    Date.now(),
                ).toLocaleDateString()}
                . Missing timeline evidence:{" "}
                {draft.data.preview.coverage.missingTimelineEvidence.toString()}
                .
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          publish.mutate({ draftId, confirmed: true });
        }}
      >
        {error === null ? null : (
          <p role="alert" className="text-sm text-scout-danger">
            {error}
          </p>
        )}
        <Button
          type="submit"
          disabled={
            publish.isPending ||
            draft.data.preview === null ||
            draft.data.publishedVersionId !== null
          }
        >
          {draft.data.publishedVersionId === null
            ? "Publish challenge"
            : "Already published"}
        </Button>
        <p className="text-xs text-scout-subtle">
          Publishing makes this version immediately visible to every signed-in
          Scout user with challenge access.
        </p>
      </form>
    </div>
  );
}
