import {
  skipToken,
  useMutation,
  useQuery as useTanstackQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowLeftIcon, CheckIcon } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";

import { useDocumentTitle } from "#client/document-title.ts";
import { ScoreField } from "#client/score-field.tsx";
import { useTRPC } from "#client/trpc.ts";
import * as BadgeUi from "#components/ui/badge.tsx";
import { Button } from "#components/ui/button.tsx";
import * as CardUi from "#components/ui/card.tsx";
import { Textarea } from "#components/ui/textarea.tsx";
import { DatasetIdSchema, FreshnessRatingSchema } from "#shared/schema.ts";

export function FreshnessPage(): React.JSX.Element {
  const parameters = useParams();
  const datasetResult = DatasetIdSchema.safeParse(parameters["datasetId"]);
  const styleKey = parameters["styleKey"];
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const input =
    styleKey !== undefined && datasetResult.success
      ? { datasetId: datasetResult.data, styleKey }
      : skipToken;
  const batchQuery = useTanstackQuery(
    trpc.freshness.detail.queryOptions(input),
  );
  const batch = batchQuery.data;
  useDocumentTitle(
    batch === undefined ? "Freshness" : `${batch.styleKey} freshness`,
  );
  const mutation = useMutation(
    trpc.freshness.rate.mutationOptions({
      onSuccess: () => {
        if (styleKey === undefined || !datasetResult.success) return;
        void queryClient.invalidateQueries({
          queryKey: trpc.freshness.detail.queryKey({
            datasetId: datasetResult.data,
            styleKey,
          }),
        });
        void navigate(`/datasets/${datasetResult.data}`);
      },
    }),
  );

  if (styleKey === undefined || !datasetResult.success) {
    return (
      <main className="mx-auto max-w-5xl p-8">Invalid freshness URL.</main>
    );
  }
  if (batchQuery.isError) {
    return (
      <main className="mx-auto max-w-5xl p-8">Freshness batch not found.</main>
    );
  }
  if (batch === undefined) {
    return (
      <main className="mx-auto max-w-5xl p-8">Loading style batch...</main>
    );
  }

  const submit = (
    event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): void => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    mutation.mutate({
      datasetId: datasetResult.data,
      generationSetRevision: batch.generationSetRevision,
      styleKey,
      rating: FreshnessRatingSchema.parse({
        score: Number(data["freshness"]),
        note: data["note"],
      }),
    });
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Button
        className="-ml-2 mb-4"
        nativeButton={false}
        render={<Link to={`/datasets/${datasetResult.data}`} />}
        variant="ghost"
      >
        <ArrowLeftIcon /> Dataset
      </Button>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section>
          <h1 className="text-2xl font-semibold">
            Freshness: {batch.styleKey}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Review the batch for repeated openings, jokes, insults, and
            structures. Similarity hints are intentionally hidden.
          </p>
        </section>

        <aside className="lg:sticky lg:top-4 lg:row-span-2">
          <CardUi.Card className="border shadow-none">
            <CardUi.CardHeader>
              <CardUi.CardTitle>Freshness score</CardUi.CardTitle>
            </CardUi.CardHeader>
            <CardUi.CardContent>
              <form className="space-y-5" onSubmit={submit}>
                <ScoreField
                  defaultScore={batch.rating?.score}
                  description="Does the voice remain recognizable without becoming formulaic?"
                  legend="Across this batch"
                  name="freshness"
                />
                <label
                  className="field-label text-slate-950"
                  htmlFor="freshness-note"
                >
                  Optional note
                  <Textarea
                    defaultValue={batch.rating?.note}
                    id="freshness-note"
                    maxLength={2000}
                    name="note"
                    placeholder="What repeated or stayed varied?"
                  />
                </label>
                {mutation.error === null ? null : (
                  <p className="text-sm text-red-700" role="alert">
                    {mutation.error.message}
                  </p>
                )}
                <Button
                  className="w-full"
                  disabled={mutation.isPending}
                  type="submit"
                >
                  <CheckIcon /> Save freshness
                </Button>
              </form>
            </CardUi.CardContent>
          </CardUi.Card>
        </aside>

        <section className="grid gap-3 lg:col-start-1 lg:row-start-2">
          {batch.reviews.map((review, index) => (
            <CardUi.Card className="border shadow-none" key={review.caseId}>
              <CardUi.CardHeader className="border-b bg-slate-50">
                <div className="flex items-center justify-between gap-3">
                  <CardUi.CardTitle className="text-base">
                    {review.playerName} on {review.championName}
                  </CardUi.CardTitle>
                  <BadgeUi.Badge variant="outline">
                    {review.performanceSlice}
                  </BadgeUi.Badge>
                </div>
              </CardUi.CardHeader>
              <CardUi.CardContent className="pt-5">
                <span className="mb-3 block font-mono text-[10px] text-slate-500 uppercase">
                  Review {String(index + 1).padStart(2, "0")}
                </span>
                <p className="text-sm leading-6">{review.outputText}</p>
              </CardUi.CardContent>
            </CardUi.Card>
          ))}
        </section>
      </div>
    </main>
  );
}
