import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowRightIcon, CheckCircle2Icon } from "lucide-react";
import { Link, useParams } from "react-router";

import { useDocumentTitle } from "#client/document-title.ts";
import { freshnessAvailability } from "#client/freshness-availability.ts";
import { useTRPC } from "#client/trpc.ts";
import { Badge } from "#components/ui/badge.tsx";
import { Button } from "#components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#components/ui/card.tsx";
import { Progress } from "#components/ui/progress.tsx";
import { DatasetIdSchema } from "#shared/schema.ts";

function FreshnessCard({
  datasetId,
  freshness,
}: {
  datasetId: string;
  freshness: ReturnType<typeof freshnessAvailability>;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Freshness</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {freshness.generatedCaseCount === 0 ? (
          <p className="text-sm text-slate-500">
            Generate reviews to unlock batch rating.
          </p>
        ) : null}
        {freshness.missingRatingCount > 0 ? (
          <p className="text-sm text-slate-500">
            Complete {freshness.missingRatingCount} more individual{" "}
            {freshness.missingRatingCount === 1 ? "rating" : "ratings"} to
            unlock batch freshness.
          </p>
        ) : null}
        {freshness.isAvailable
          ? freshness.styleKeys.map((styleKey) => (
              <Button
                className="w-full justify-between"
                key={styleKey}
                nativeButton={false}
                render={
                  <Link
                    to={`/datasets/${datasetId}/freshness/${encodeURIComponent(styleKey)}`}
                  />
                }
                variant="outline"
              >
                {styleKey} <ArrowRightIcon />
              </Button>
            ))
          : null}
      </CardContent>
    </Card>
  );
}

export function DatasetPage(): React.JSX.Element {
  const parameters = useParams();
  const idResult = DatasetIdSchema.safeParse(parameters["datasetId"]);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const datasetsQuery = useQuery(trpc.datasets.list.queryOptions());
  const casesQuery = useQuery(
    trpc.cases.list.queryOptions(
      idResult.success ? { datasetId: idResult.data } : skipToken,
    ),
  );
  const dataset = datasetsQuery.data?.find(
    (candidate) => idResult.success && candidate.id === idResult.data,
  );
  useDocumentTitle(dataset?.name ?? "Dataset");
  const finalizeMutation = useMutation(
    trpc.datasets.finalize.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.datasets.list.queryKey(),
        });
      },
    }),
  );

  if (!idResult.success) {
    return <main className="mx-auto max-w-5xl p-8">Invalid dataset URL.</main>;
  }
  if (datasetsQuery.isError || casesQuery.isError) {
    return (
      <main className="mx-auto max-w-5xl p-8" role="alert">
        Dataset could not be loaded.
      </main>
    );
  }
  if (dataset === undefined && datasetsQuery.data !== undefined) {
    return <main className="mx-auto max-w-5xl p-8">Dataset not found.</main>;
  }
  if (dataset === undefined || casesQuery.data === undefined) {
    return <main className="mx-auto max-w-5xl p-8">Loading dataset...</main>;
  }

  const cases = casesQuery.data;
  const resumeCase = cases.find(
    (evalCase) => !evalCase.isRated && evalCase.generationId !== null,
  );
  const freshness = freshnessAvailability(cases);
  const progress =
    dataset.caseCount === 0
      ? 0
      : (dataset.ratedCaseCount / dataset.caseCount) * 100;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Button
        className="-ml-2 mb-4"
        nativeButton={false}
        render={<Link to="/" />}
        variant="ghost"
      >
        <ArrowLeftIcon /> All datasets
      </Button>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section>
          <div className="flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-end">
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Badge>{dataset.status}</Badge>
                <span className="font-mono text-xs text-slate-500">
                  version {dataset.version}
                </span>
              </div>
              <h1 className="text-2xl font-semibold">{dataset.name}</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                {dataset.description || "No dataset description."}
              </p>
            </div>
            {resumeCase === undefined ? null : (
              <Button
                nativeButton={false}
                render={
                  <Link to={`/datasets/${dataset.id}/cases/${resumeCase.id}`} />
                }
              >
                Resume rating <ArrowRightIcon />
              </Button>
            )}
          </div>

          <div className="mt-5 space-y-2">
            {cases.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-slate-500">
                  This draft has no materialized cases yet.
                </CardContent>
              </Card>
            ) : null}
            {cases.map((evalCase) => (
              <Link
                className="case-row"
                key={evalCase.id}
                to={`/datasets/${dataset.id}/cases/${evalCase.id}`}
              >
                <span className="case-number">
                  {String(evalCase.ordinal + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {evalCase.targetPlayerName} on {evalCase.championName}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>{evalCase.matchId}</span>
                    <span>·</span>
                    <span>{evalCase.styleKey}</span>
                  </span>
                </span>
                <Badge variant="outline">{evalCase.performanceSlice}</Badge>
                {evalCase.isRated ? (
                  <CheckCircle2Icon
                    className="size-5 text-emerald-600"
                    aria-label="Rated"
                  />
                ) : (
                  <ArrowRightIcon className="size-4 text-slate-500" />
                )}
              </Link>
            ))}
          </div>
        </section>

        <aside className="space-y-5">
          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle>Calibration progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex items-baseline justify-between">
                <strong className="text-xl">{dataset.ratedCaseCount}</strong>
                <span className="text-sm text-slate-500">
                  of {dataset.caseCount}
                </span>
              </div>
              <Progress value={progress} />
            </CardContent>
          </Card>

          <FreshnessCard datasetId={dataset.id} freshness={freshness} />

          {dataset.status === "draft" ? (
            <>
              <Card className="border shadow-none">
                <CardHeader>
                  <CardTitle>Materialize cases</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-3 text-sm leading-6 text-slate-600">
                    Target this draft from a materialization spec:
                  </p>
                  <pre
                    aria-label="Materialization target"
                    className="whitespace-pre-wrap break-all rounded-md bg-slate-950 p-3 text-xs text-slate-50"
                  >
                    {JSON.stringify({ datasetId: dataset.id }, null, 2)}
                  </pre>
                </CardContent>
              </Card>
              <Card className="border shadow-none">
                <CardHeader>
                  <CardTitle>Finalize dataset</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-4 text-sm leading-6 text-slate-600">
                    Finalizing permanently locks case membership and artifacts.
                  </p>
                  {finalizeMutation.error === null ? null : (
                    <p className="mb-3 text-sm text-red-700" role="alert">
                      {finalizeMutation.error.message}
                    </p>
                  )}
                  <Button
                    className="w-full"
                    disabled={
                      dataset.caseCount === 0 || finalizeMutation.isPending
                    }
                    onClick={() => {
                      finalizeMutation.mutate({ datasetId: dataset.id });
                    }}
                    variant="outline"
                  >
                    Finalize dataset
                  </Button>
                </CardContent>
              </Card>
            </>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
