import type { Persona } from "#testing/fixture-api/personas.ts";
import { FEATURED } from "#testing/fixture-api/fixtures/titles.ts";

export type RouteCase = {
  /** Stable name for test titles and the axe baseline. */
  label: string;
  persona: Persona;
  path: string;
  /** The page's level-one heading, proving the route rendered its own page. */
  heading: string;
  /** The document title the page sets. */
  title: string;
};

/** A route whose title is its heading, as every page built on PageTitle is. */
type RouteSpec = Omit<RouteCase, "title"> & { title?: string };

const movie = FEATURED.movie;
const series = FEATURED.series;

/** The pages both personas read; an owner sees extra controls on each. */
function shared(persona: Persona): RouteSpec[] {
  return [
    { label: `${persona} /library`, path: "/library", heading: "Library" },
    {
      label: `${persona} /library/mine`,
      path: "/library/mine",
      heading: "Library",
    },
    {
      label: `${persona} /library/leaving`,
      path: "/library/leaving",
      heading: "Library",
    },
    {
      label: `${persona} /library/removed`,
      path: "/library/removed",
      heading: "Library",
    },
    {
      label: `${persona} /history`,
      path: "/history",
      heading: "Watch history",
    },
    {
      label: `${persona} /notifications`,
      path: "/notifications",
      heading: "Notifications",
    },
    {
      label: `${persona} /recovery`,
      path: "/recovery",
      heading: "Recovery protection",
    },
    {
      label: `${persona} /media/:movie`,
      path: `/media/${movie.id}`,
      heading: movie.title,
    },
    {
      label: `${persona} /media/:series`,
      path: `/media/${series.id}`,
      heading: series.title,
    },
  ].map((route) => ({ ...route, persona }));
}

/**
 * Every route a household member can open from navigation or a list.
 *
 * Not covered, because the read-only fixture API cannot answer them: the
 * review pages `/recovery/:id` and `/recovery/movies/:id` (their detail
 * contracts have no fixture yet) and the `/notifications/email` and
 * `/notifications/discord` callbacks, which write as soon as they load.
 */
const MEMBER_ROUTES: readonly RouteSpec[] = [
  {
    label: "member /discover",
    persona: "member",
    path: "/discover",
    heading: "Discover",
  },
  {
    label: "member /discover?q=",
    persona: "member",
    path: "/discover?q=the",
    heading: "Discover",
  },
  {
    label: "member /discover/:feed",
    persona: "member",
    path: "/discover/popular-films",
    heading: "Popular films",
  },
  {
    label: "member /calendar",
    persona: "member",
    path: "/calendar",
    heading: "Calendar",
  },
  {
    label: "member /catalog/movie/:id",
    persona: "member",
    path: `/catalog/movie/${String(movie.tmdbId)}`,
    heading: movie.title,
  },
  {
    label: "member /catalog/series/:id",
    persona: "member",
    path: `/catalog/series/${String(series.tmdbId)}`,
    heading: series.title,
  },
  {
    label: "member /media/:protection-only",
    persona: "member",
    path: `/media/${FEATURED.protectionOnly.id}`,
    heading: "Request protections",
  },
  ...shared("member"),
];

/** The owner's Manage pages, each opened by its own address. */
const MANAGE_ROUTES: readonly RouteSpec[] = [
  { path: "/manage/household", heading: "Household" },
  { path: "/manage/quality", heading: "Quality" },
  { path: "/manage/subtitles", heading: "Subtitles" },
  { path: "/manage/plex", heading: "Plex" },
  { path: "/manage/numbering", heading: "Numbering" },
  { path: "/manage/providers", heading: "Providers and seeding" },
  { path: "/manage/activity", heading: "Activity" },
  { path: "/manage/recovery", heading: "Recovery" },
  { path: "/manage/migration", heading: "Migration" },
].map((route) => ({
  ...route,
  label: `owner ${route.path}`,
  persona: "owner" as const,
}));

/**
 * The owner's own pages, plus the household pages that show an owner more
 * than a member (library keeping controls, title administration).
 *
 * Not covered: `/manage/recovery/native` and
 * `/manage/subtitles/replacements`, whose operator inventories have no
 * fixture yet.
 */
const OWNER_ROUTES: readonly RouteSpec[] = [
  ...MANAGE_ROUTES,
  ...shared("owner"),
];

export const ROUTES: readonly RouteCase[] = [
  ...MEMBER_ROUTES,
  ...OWNER_ROUTES,
].map((route) => ({
  ...route,
  title: route.title ?? `${route.heading} · Media`,
}));
