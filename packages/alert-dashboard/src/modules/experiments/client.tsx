import { FlaskConicalIcon, PlusIcon } from "lucide-react";
import { lazy } from "react";

import type { ClientModule, ModuleSearch } from "#client/platform/module.ts";
import { fetchReportsJson } from "#client/reports/reports-api.ts";

const API = "/api/experiments";

const ListPage = lazy(async () => {
  const { ExperimentsListPage } =
    await import("@shepherdjerred/experiments/browser/list");
  return { default: () => <ExperimentsListPage api={API} /> };
});

const NewPage = lazy(async () => {
  const { NewExperimentPage } =
    await import("@shepherdjerred/experiments/browser/draft");
  return { default: () => <NewExperimentPage api={API} /> };
});

const DetailPage = lazy(async () => {
  const { ExperimentDetailPage } =
    await import("@shepherdjerred/experiments/browser/detail");
  return { default: () => <ExperimentDetailPage api={API} /> };
});

const search: ModuleSearch = async (query, signal) => {
  const value = query.trim();
  if (value === "") return [];
  const { ExperimentListSchema } =
    await import("@shepherdjerred/experiments/contract");
  const params = new URLSearchParams({ q: value });
  const response = await fetchReportsJson(
    API + "?" + params.toString(),
    ExperimentListSchema,
    signal,
  );
  return response.items.slice(0, 6).map((item) => ({
    id: `experiment-${item.id}`,
    group: "Experiments",
    label: item.title,
    detail: item.owner,
    to: "/experiments/" + encodeURIComponent(item.id),
  }));
};

export const experimentsClientModule: ClientModule = {
  id: "experiments",
  title: "Experiments",
  icon: FlaskConicalIcon,
  basePath: "/experiments",
  routes: [
    { path: "", page: ListPage },
    { path: "new", page: NewPage },
    { path: ":id", page: DetailPage },
  ],
  nav: [
    { label: "Experiments", group: "Ops", icon: FlaskConicalIcon, path: "" },
  ],
  commands: [
    {
      id: "new",
      label: "New experiment",
      icon: PlusIcon,
      run: ({ navigate }) => {
        navigate("/experiments/new");
      },
    },
  ],
  search,
};
