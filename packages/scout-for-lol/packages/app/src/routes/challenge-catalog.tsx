import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Compass, Plus } from "lucide-react";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { Input } from "@scout-for-lol/design-system/components/input";
import { useTRPC } from "#src/lib/trpc.ts";

export function ChallengeCatalog() {
  const trpc = useTRPC();
  const [query, setQuery] = useState("");
  const catalog = useQuery(
    trpc.challenge.catalogSearch.queryOptions({
      ...(query.trim().length === 0 ? {} : { query: query.trim() }),
    }),
  );
  const runs = useQuery(trpc.challenge.runHistory.queryOptions());

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-primary">Community goals</p>
          <h1 className="text-3xl font-semibold tracking-tight">Challenges</h1>
          <p className="max-w-2xl text-scout-subtle">
            Start clean today or import Scout-known history. Progress comes only
            from frozen, observable match rules.
          </p>
        </div>
        <Button asChild>
          <Link to="/explore">
            <Compass className="size-4" /> Describe a challenge
          </Link>
        </Button>
      </header>

      <section className="space-y-3" aria-labelledby="challenge-catalog-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="challenge-catalog-title" className="text-xl font-semibold">
              Catalog
            </h2>
            <p className="text-sm text-scout-subtle">
              Published templates are global and immutable by version.
            </p>
          </div>
          <label className="grid gap-1 text-sm" htmlFor="challenge-search">
            <span className="sr-only">Search challenges</span>
            <Input
              id="challenge-search"
              type="search"
              placeholder="Search challenges"
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
              }}
            />
          </label>
        </div>
        {catalog.isPending ? (
          <p className="text-sm text-scout-subtle">Loading catalog…</p>
        ) : null}
        {catalog.isError ? (
          <p className="text-sm text-scout-danger">{catalog.error.message}</p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {catalog.data?.map((template) => (
            <Card key={template.templateId}>
              <CardHeader>
                <CardTitle>{template.contract.title}</CardTitle>
                <CardDescription>{template.contract.summary}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-3">
                <Badge variant="outline">v{template.version.toString()}</Badge>
                <Button asChild size="sm">
                  <Link to={`/challenges/${template.templateId}`}>
                    View challenge
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="challenge-runs-title">
        <h2 id="challenge-runs-title" className="text-xl font-semibold">
          Your runs
        </h2>
        {runs.data?.length === 0 ? (
          <p className="text-sm text-scout-subtle">No runs yet.</p>
        ) : null}
        <ul className="grid gap-3 md:grid-cols-2">
          {runs.data?.map((run) => (
            <li key={run.id}>
              <Link
                className="block rounded-lg border bg-scout-surface p-4 hover:bg-scout-hover"
                to={`/challenge-runs/${run.id}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <strong>{run.title}</strong>
                  <Badge variant="outline">
                    {run.recomputing ? "recomputing" : run.status}
                  </Badge>
                </span>
                <span className="mt-2 block text-sm text-scout-subtle">
                  Started {new Date(run.originalStartAt).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Button asChild variant="outline" size="sm">
          <Link to="/explore">
            <Plus className="size-4" /> Author in Explore
          </Link>
        </Button>
      </section>
    </div>
  );
}
