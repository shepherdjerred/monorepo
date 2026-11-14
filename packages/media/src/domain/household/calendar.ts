import {
  CalendarDateSchema,
  MovieReleaseDateSchema,
  type MovieReleaseDate,
} from "#shared/household/calendar.ts";

export function seriesLifecycleStatus(status: string | undefined) {
  switch (status) {
    case "Ended":
      return "ended" as const;
    case "Canceled":
      return "cancelled" as const;
    case "Returning Series":
    case "In Production":
    case "Planned":
    case "Pilot":
      return "continuing" as const;
    case undefined:
    default:
      return "unknown" as const;
  }
}

/** TMDB release timestamps describe a release day, not local viewing time. */
export function normalizeMovieReleases(
  rows: readonly {
    iso_3166_1: string;
    release_dates: readonly { type: number; release_date: string }[];
  }[],
): MovieReleaseDate[] {
  const result = new Map<string, MovieReleaseDate>();
  for (const country of rows) {
    if (country.iso_3166_1 !== "US") continue;
    for (const release of country.release_dates) {
      const kind = movieReleaseKind(release.type);
      if (kind === null) continue;
      const date =
        release.release_date === ""
          ? null
          : CalendarDateSchema.parse(release.release_date.slice(0, 10));
      result.set(
        `${kind}:${date ?? "tba"}`,
        MovieReleaseDateSchema.parse({
          kind,
          region: "US",
          date,
          precision: date === null ? "unknown" : "day",
        }),
      );
    }
  }
  return completeMovieReleaseDates(result);
}

function completeMovieReleaseDates(result: Map<string, MovieReleaseDate>) {
  for (const kind of ["theatrical", "digital", "physical"] as const)
    if (![...result.values()].some((item) => item.kind === kind))
      result.set(`${kind}:tba`, {
        kind,
        region: "US",
        date: null,
        precision: "unknown",
      });
  return [...result.values()].sort((left, right) =>
    `${left.date ?? "9999"}:${left.kind}`.localeCompare(
      `${right.date ?? "9999"}:${right.kind}`,
    ),
  );
}

function movieReleaseKind(type: number) {
  switch (type) {
    case 2:
    case 3:
      return "theatrical" as const;
    case 4:
      return "digital" as const;
    case 5:
      return "physical" as const;
    default:
      return null;
  }
}
