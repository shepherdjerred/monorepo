import {
  Button,
  Card,
  CardToolbar,
  PageBody,
  PageHeading,
  SearchField,
  Segmented,
} from "@shepherdjerred/console-ui";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useDeferredValue } from "react";
import { Link, useSearchParams } from "react-router";

import type { ExperimentSummary } from "@shepherdjerred/experiments/contract";
import { experimentListQuery, type ExperimentView } from "./api.ts";
import {
  EXPERIMENTS_PATH,
  NEW_EXPERIMENT_PATH,
  ExperimentStatus,
  ReviewDate,
  experimentPath,
} from "./presentation.tsx";

const VIEWS: readonly { value: ExperimentView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "due", label: "Due for review" },
  { value: "running", label: "Running" },
  { value: "drafts", label: "Drafts" },
  { value: "decided", label: "Decided" },
];

function ExperimentTable({
  items,
}: {
  readonly items: readonly ExperimentSummary[];
}) {
  return (
    <div
      className="ui-data-scroll"
      role="region"
      aria-label="Experiment list"
      tabIndex={0}
    >
      <table className="ui-data">
        <thead>
          <tr>
            <th scope="col">Experiment</th>
            <th scope="col">Owner</th>
            <th scope="col">Status</th>
            <th scope="col">Review date</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <th scope="row" data-label="Experiment">
                <Link to={experimentPath(item.id)}>{item.title}</Link>
              </th>
              <td data-label="Owner">{item.owner}</td>
              <td data-label="Status">
                <ExperimentStatus item={item} />
              </td>
              <td data-label="Review date">
                <ReviewDate date={item.reviewDate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExperimentsListPage({ api }: { readonly api: string }) {
  const [params, setParams] = useSearchParams();
  const view =
    VIEWS.find((option) => option.value === params.get("view"))?.value ?? "all";
  const query = params.get("q") ?? "";
  const search = useDeferredValue(query.trim());
  const list = useQuery(experimentListQuery(api, view, search));

  function changeParam(
    name: "view" | "q",
    value: string,
    replace = false,
  ): void {
    const next = new URLSearchParams(params);
    if (value === "" || (name === "view" && value === "all")) next.delete(name);
    else next.set(name, value);
    setParams(next, { replace });
  }

  return (
    <PageBody className="experiments-page">
      <PageHeading
        eyebrow="Ops"
        title="Experiments"
        actions={
          <Link
            className="ui-btn"
            data-size="page"
            data-variant="primary"
            to={NEW_EXPERIMENT_PATH}
          >
            <PlusIcon aria-hidden="true" /> New experiment
          </Link>
        }
      />
      <Card label="Experiments">
        <search>
          <CardToolbar>
            <Segmented
              label="Experiment status"
              value={view}
              options={VIEWS}
              onChange={(next) => {
                changeParam("view", next);
              }}
            />
            <form
              action={EXPERIMENTS_PATH}
              method="get"
              onSubmit={(event) => {
                event.preventDefault();
              }}
            >
              <SearchField
                name="q"
                label="Search experiments"
                placeholder="Search experiments"
                value={query}
                maxLength={200}
                onChange={(event) => {
                  changeParam("q", event.currentTarget.value, true);
                }}
              />
            </form>
          </CardToolbar>
        </search>
        {list.isPending && (
          <p className="experiments-empty" role="status">
            Loading experiments…
          </p>
        )}
        {list.isError && (
          <div className="experiments-empty">
            <p role="alert">{list.error.message}</p>
            <Button
              type="button"
              onClick={() => {
                void list.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {list.data !== undefined &&
          (list.data.items.length === 0 ? (
            <p className="experiments-empty">No experiments match this view.</p>
          ) : (
            <ExperimentTable items={list.data.items} />
          ))}
      </Card>
    </PageBody>
  );
}
