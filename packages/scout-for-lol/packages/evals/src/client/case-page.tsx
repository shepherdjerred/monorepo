import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  formatAggregateRatingScore,
  type RatingScoreSelection,
} from "#client/aggregate-score.ts";
import { useDocumentTitle } from "#client/document-title.ts";
import { ScoreField } from "#client/score-field.tsx";
import { useTRPC } from "#client/trpc.ts";
import { Badge } from "#components/ui/badge.tsx";
import { Button } from "#components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#components/ui/card.tsx";
import { Textarea } from "#components/ui/textarea.tsx";
import {
  CaseIdSchema,
  DatasetIdSchema,
  type HumanRating,
  HumanRatingSchema,
} from "#shared/schema.ts";

function Evidence({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <details className="evidence-panel">
      <summary>{label}</summary>
      <pre>{value || "No content recorded."}</pre>
    </details>
  );
}

function HumanScorecardForm({
  defaultRating,
  errorMessage,
  isPending,
  onSubmit,
}: {
  defaultRating: HumanRating | null;
  errorMessage: string | null;
  isPending: boolean;
  onSubmit: (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
}): React.JSX.Element {
  const [selection, setSelection] = useState<RatingScoreSelection>(() => ({
    anchoredness: defaultRating?.anchoredness,
    entertainment: defaultRating?.entertainment,
    styleRecognizability: defaultRating?.styleRecognizability,
  }));

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <ScoreField
        defaultScore={defaultRating?.anchoredness}
        description="Does the joke grow from this match's distinctive story?"
        legend="Anchoredness"
        name="anchoredness"
        onScoreChange={(anchoredness) => {
          setSelection((current) => ({ ...current, anchoredness }));
        }}
      />
      <ScoreField
        defaultScore={defaultRating?.entertainment}
        description="Is it funny, memorable, quotable, or reaction-worthy?"
        legend="Entertainment"
        name="entertainment"
        onScoreChange={(entertainment) => {
          setSelection((current) => ({ ...current, entertainment }));
        }}
      />
      <ScoreField
        defaultScore={defaultRating?.styleRecognizability}
        description="Is the assigned voice distinctly recognizable?"
        legend="Style recognizability"
        name="styleRecognizability"
        onScoreChange={(styleRecognizability) => {
          setSelection((current) => ({
            ...current,
            styleRecognizability,
          }));
        }}
      />
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-medium text-slate-700">Overall score</p>
        <output
          aria-label="Overall score"
          aria-live="polite"
          className="mt-1 block text-2xl font-semibold text-slate-950"
        >
          {formatAggregateRatingScore(selection)}
        </output>
        <p className="mt-1 text-xs text-slate-500">
          Simple mean of the three rubric dimensions.
        </p>
      </div>
      <label className="field-label text-slate-950" htmlFor="case-note">
        Optional note
        <Textarea
          defaultValue={defaultRating?.note}
          id="case-note"
          maxLength={2000}
          name="note"
          placeholder="What drove the score?"
        />
      </label>
      {errorMessage === null ? null : (
        <p className="text-sm text-red-700" role="alert">
          {errorMessage}
        </p>
      )}
      <Button className="w-full" disabled={isPending} type="submit">
        Save and next <ArrowRightIcon />
      </Button>
    </form>
  );
}

export function CasePage(): React.JSX.Element {
  const parameters = useParams();
  const datasetResult = DatasetIdSchema.safeParse(parameters["datasetId"]);
  const caseResult = CaseIdSchema.safeParse(parameters["caseId"]);
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detailQuery = useQuery(
    trpc.cases.detail.queryOptions(
      caseResult.success && datasetResult.success
        ? { caseId: caseResult.data, datasetId: datasetResult.data }
        : skipToken,
    ),
  );
  const detail = detailQuery.data;
  useDocumentTitle(
    detail === undefined
      ? "Review case"
      : `${detail.summary.targetPlayerName} review`,
  );
  const rateMutation = useMutation(
    trpc.cases.rate.mutationOptions({
      onSuccess: () => {
        if (detail === undefined || !datasetResult.success) return;
        void queryClient.invalidateQueries({
          queryKey: trpc.cases.detail.queryKey({
            caseId: detail.summary.id,
            datasetId: datasetResult.data,
          }),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.cases.list.queryKey({ datasetId: datasetResult.data }),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.datasets.list.queryKey(),
        });
        const destination =
          detail.nextCaseId === null
            ? `/datasets/${datasetResult.data}`
            : `/datasets/${datasetResult.data}/cases/${detail.nextCaseId}`;
        void navigate(destination);
      },
    }),
  );

  if (!datasetResult.success || !caseResult.success) {
    return <main className="mx-auto max-w-5xl p-8">Invalid case URL.</main>;
  }
  if (detailQuery.isError) {
    return <main className="mx-auto max-w-5xl p-8">Case not found.</main>;
  }
  if (detail === undefined) {
    return (
      <main className="mx-auto max-w-5xl p-8">Loading review case...</main>
    );
  }

  const submit = (
    event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): void => {
    event.preventDefault();
    if (detail.generation === null)
      throw new Error("Cannot rate a case without a generation");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const rating = HumanRatingSchema.parse({
      anchoredness: Number(data["anchoredness"]),
      entertainment: Number(data["entertainment"]),
      styleRecognizability: Number(data["styleRecognizability"]),
      note: data["note"],
    });
    rateMutation.mutate({ generationId: detail.generation.id, rating });
  };
  const context = detail.artifact.context;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <Button
          nativeButton={false}
          render={<Link to={`/datasets/${datasetResult.data}`} />}
          variant="ghost"
        >
          <ArrowLeftIcon /> Dataset
        </Button>
        <nav className="flex items-center gap-2" aria-label="Case navigation">
          <Button
            aria-label="Previous case"
            disabled={detail.previousCaseId === null}
            nativeButton={false}
            render={
              detail.previousCaseId === null ? undefined : (
                <Link
                  to={`/datasets/${datasetResult.data}/cases/${detail.previousCaseId}`}
                />
              )
            }
            size="icon"
            variant="outline"
          >
            <ChevronLeftIcon />
          </Button>
          <span className="font-mono text-xs text-slate-500">
            case {detail.summary.ordinal + 1}
          </span>
          <Button
            aria-label="Next case"
            disabled={detail.nextCaseId === null}
            nativeButton={false}
            render={
              detail.nextCaseId === null ? undefined : (
                <Link
                  to={`/datasets/${datasetResult.data}/cases/${detail.nextCaseId}`}
                />
              )
            }
            size="icon"
            variant="outline"
          >
            <ChevronRightIcon />
          </Button>
        </nav>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="space-y-5">
          <div>
            <h1 className="text-2xl font-semibold">
              {detail.summary.targetPlayerName} on {detail.summary.championName}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge>{detail.summary.performanceSlice}</Badge>
              <Badge variant="outline">voice: {detail.summary.styleKey}</Badge>
              <Badge variant="secondary">{detail.summary.matchId}</Badge>
            </div>
          </div>

          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle>Generated review</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.generation === null ? (
                <p className="text-sm text-slate-600">
                  No baseline generation has been recorded for this case.
                </p>
              ) : (
                <blockquote className="text-lg leading-7">
                  {detail.generation.outputText}
                </blockquote>
              )}
            </CardContent>
          </Card>
        </section>

        <aside className="lg:sticky lg:top-4 lg:row-span-2">
          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle>Human scorecard</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.generation === null ? (
                <p className="text-sm text-slate-500">
                  Generate a review before rating this case.
                </p>
              ) : (
                <HumanScorecardForm
                  defaultRating={detail.rating}
                  errorMessage={rateMutation.error?.message ?? null}
                  isPending={rateMutation.isPending}
                  key={detail.generation.id}
                  onSubmit={submit}
                />
              )}
            </CardContent>
          </Card>
        </aside>

        <section className="lg:col-start-1 lg:row-start-2">
          <h2 className="text-base font-semibold">Context</h2>
          <p className="mt-1 mb-3 text-sm text-slate-500">
            Match facts, summaries, style inputs, and exact prompts.
          </p>
          <div className="space-y-2">
            <Evidence
              label="Deterministic match facts"
              value={context.deterministicFacts}
            />
            <Evidence
              label="Generated match summary"
              value={context.matchSummary}
            />
            <Evidence
              label="Timeline summary"
              value={context.timelineSummary}
            />
            <Evidence label="Lane context" value={context.laneContext} />
            <Evidence label="Style card" value={context.styleCard} />
            <Evidence
              label="Personality instructions"
              value={context.personalityInstructions}
            />
            {detail.generation === null ? null : (
              <>
                <Evidence
                  label="Exact system prompt"
                  value={
                    detail.generation.renderedPrompts.reviewText.systemPrompt
                  }
                />
                <Evidence
                  label="Exact user prompt"
                  value={
                    detail.generation.renderedPrompts.reviewText.userPrompt
                  }
                />
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
