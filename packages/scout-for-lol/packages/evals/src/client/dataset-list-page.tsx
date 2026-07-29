import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { useDocumentTitle } from "#client/document-title.ts";
import { useTRPC } from "#client/trpc.ts";
import { Badge } from "#components/ui/badge.tsx";
import { Button } from "#components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#components/ui/card.tsx";
import { CreateDatasetInputSchema } from "#shared/schema.ts";

export function DatasetListPage(): React.JSX.Element {
  useDocumentTitle("Datasets");
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const datasetsQuery = useQuery(trpc.datasets.list.queryOptions());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const createMutation = useMutation(
    trpc.datasets.create.mutationOptions({
      onError: (error) => {
        setErrorMessage(error.message);
      },
      onSuccess: (dataset) => {
        void queryClient.invalidateQueries({
          queryKey: trpc.datasets.list.queryKey(),
        });
        void navigate(`/datasets/${dataset.id}`);
      },
    }),
  );

  const submit = (
    event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): void => {
    event.preventDefault();
    setErrorMessage(null);
    const inputResult = CreateDatasetInputSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!inputResult.success) {
      setErrorMessage(
        inputResult.error.issues[0]?.message ?? "Invalid dataset",
      );
      return;
    }
    createMutation.mutate(inputResult.data);
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section>
          <h1 className="text-2xl font-semibold">Datasets</h1>
          <p className="mt-1 text-sm text-slate-600">
            Review cases, ratings, and freshness checks.
          </p>

          <div className="mt-6 grid gap-3">
            {datasetsQuery.isPending ? (
              <Card>
                <CardContent className="py-8">Loading datasets...</CardContent>
              </Card>
            ) : null}
            {datasetsQuery.isError ? (
              <p className="text-sm text-red-700" role="alert">
                Could not load datasets: {datasetsQuery.error.message}
              </p>
            ) : null}
            {datasetsQuery.data?.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-slate-500">
                  No datasets yet.
                </CardContent>
              </Card>
            ) : null}
            {datasetsQuery.data?.map((dataset) => (
              <Card className="border shadow-none" key={dataset.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle>{dataset.name}</CardTitle>
                      <CardDescription className="mt-1">
                        {dataset.description || "No description"}
                      </CardDescription>
                    </div>
                    <Badge
                      variant={
                        dataset.status === "finalized" ? "default" : "secondary"
                      }
                    >
                      {dataset.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex items-end justify-between gap-4">
                  <div className="flex gap-6 font-mono text-xs text-slate-500">
                    <span>{dataset.caseCount} cases</span>
                    <span>{dataset.ratedCaseCount} rated</span>
                    <span>v{dataset.version}</span>
                  </div>
                  <Button
                    nativeButton={false}
                    render={<Link to={`/datasets/${dataset.id}`} />}
                  >
                    Open <ArrowRightIcon />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <aside>
          <Card className="sticky top-4 border shadow-none">
            <CardHeader>
              <CardTitle>New draft</CardTitle>
              <CardDescription>
                Create an empty dataset record. Materialization adds cases.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={submit}>
                <label className="field-label">
                  Dataset name
                  <input className="form-input" name="name" required />
                </label>
                <label className="field-label">
                  Stable key
                  <input
                    className="form-input"
                    name="key"
                    placeholder="calibration-20"
                    required
                  />
                </label>
                <label className="field-label">
                  Description
                  <textarea
                    className="form-input min-h-20 resize-y"
                    name="description"
                  />
                </label>
                {errorMessage === null ? null : (
                  <p className="text-sm text-red-700" role="alert">
                    {errorMessage}
                  </p>
                )}
                <Button
                  className="w-full"
                  disabled={createMutation.isPending}
                  type="submit"
                >
                  Create draft
                </Button>
              </form>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
