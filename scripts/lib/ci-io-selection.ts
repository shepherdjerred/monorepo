import type { BuildkiteBuild, TimeWindow } from "./ci-io-api.ts";
import type {
  BuildCohort,
  UnfinishedBuildReport,
} from "./ci-io-report-model.ts";

const METRIC_WINDOW_PADDING_MILLISECONDS = 30_000;

export type BuildSelection = {
  builds: BuildkiteBuild[];
  window: TimeWindow;
  cohort: BuildCohort | null;
  unfinishedBuilds: UnfinishedBuildReport[];
};

function unfinishedBuildReport(
  build: BuildkiteBuild,
  disposition: UnfinishedBuildReport["disposition"],
): UnfinishedBuildReport {
  return {
    buildNumber: build.number,
    branch: build.branch,
    state: build.state,
    createdAt: build.created_at,
    buildUrl: build.web_url,
    disposition,
  };
}

function sortedBuilds(builds: BuildkiteBuild[]): BuildkiteBuild[] {
  return [...builds].sort((left, right) => left.number - right.number);
}

function sortedUnfinishedBuilds(
  builds: UnfinishedBuildReport[],
): UnfinishedBuildReport[] {
  return [...builds].sort(
    (left, right) => left.buildNumber - right.buildNumber,
  );
}

export function metricWindowForBuilds(
  builds: BuildkiteBuild[],
  now: Date,
): TimeWindow {
  if (builds.length === 0) {
    throw new Error("cannot derive a metric window without selected builds");
  }
  const starts = builds.flatMap((build) => [
    new Date(build.created_at).getTime(),
    ...build.jobs.flatMap((job) =>
      job.started_at === null ? [] : [new Date(job.started_at).getTime()],
    ),
  ]);
  const ends = builds.flatMap((build) => [
    build.finished_at === null
      ? now.getTime()
      : new Date(build.finished_at).getTime(),
    ...build.jobs.flatMap((job) =>
      job.finished_at === null ? [] : [new Date(job.finished_at).getTime()],
    ),
  ]);
  const earliest = Math.min(...starts) - METRIC_WINDOW_PADDING_MILLISECONDS;
  const latest = Math.max(...ends) + METRIC_WINDOW_PADDING_MILLISECONDS;
  const to = Math.min(latest, now.getTime());
  if (to <= earliest) {
    throw new Error("derived metric window end must be after its start");
  }
  return { from: new Date(earliest), to: new Date(to) };
}

export function selectCohortBuilds(
  builds: BuildkiteBuild[],
  cohortWindow: TimeWindow,
  now: Date,
): BuildSelection {
  if (cohortWindow.to.getTime() <= cohortWindow.from.getTime()) {
    throw new Error("cohort created_at end must be after its start");
  }
  const finished = builds.filter((build) => build.finished_at !== null);
  const unfinished = builds
    .filter((build) => build.finished_at === null)
    .map((build) => unfinishedBuildReport(build, "excluded"));
  if (finished.length === 0) {
    const excludedNumbers = unfinished
      .map((build) => `#${String(build.buildNumber)}`)
      .join(", ");
    const detail = excludedNumbers === "" ? "none returned" : excludedNumbers;
    throw new Error(
      `created_at cohort has no finished builds; unfinished builds: ${detail}`,
    );
  }
  const selected = sortedBuilds(finished);
  return {
    builds: selected,
    window: metricWindowForBuilds(selected, now),
    cohort: {
      createdFrom: cohortWindow.from.toISOString(),
      createdTo: cohortWindow.to.toISOString(),
    },
    unfinishedBuilds: sortedUnfinishedBuilds(unfinished),
  };
}

export function selectExplicitBuilds(input: {
  builds: BuildkiteBuild[];
  now: Date;
}): BuildSelection {
  const unfinished = input.builds.filter((build) => build.finished_at === null);
  const selected = input.builds.filter((build) => build.finished_at !== null);
  if (selected.length === 0) {
    throw new Error("explicit build selection has no finished builds");
  }
  const sorted = sortedBuilds(selected);
  return {
    builds: sorted,
    window: metricWindowForBuilds(sorted, input.now),
    cohort: null,
    unfinishedBuilds: sortedUnfinishedBuilds(
      unfinished.map((build) => unfinishedBuildReport(build, "excluded")),
    ),
  };
}
