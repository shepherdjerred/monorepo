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
    label: "member /",
    persona: "member",
    path: "/",
    heading: "What’s your next watch?",
  },
  {
    label: "member /requests",
    persona: "member",
    path: "/requests",
    heading: "My requests",
  },
  {
    label: "member /calendar",
    persona: "member",
    path: "/calendar",
    heading: "Calendar",
  },
  {
    label: "member /activity",
    persona: "member",
    path: "/activity",
    heading: "Activity",
  },
  {
    label: "member /removals",
    persona: "member",
    path: "/removals",
    heading: "Leaving soon",
  },
  {
    label: "member /removed",
    persona: "member",
    path: "/removed",
    heading: "Removed titles",
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

/**
 * The owner's own pages, plus the household pages that show an owner more
 * than a member (library keeping controls, title administration).
 *
 * Not covered: `/recovery/native` and `/admin/subtitle-replacements`, whose
 * operator inventories have no fixture yet.
 */
const OWNER_ROUTES: readonly RouteSpec[] = [
  {
    label: "owner /admin",
    persona: "owner",
    path: "/admin",
    heading: "Administration",
  },
  {
    label: "owner /admin/migration",
    persona: "owner",
    path: "/admin/migration",
    heading: "Bring your library over.",
    // This page has no PageTitle and keeps the title from index.html.
    title: "Media · Your next watch",
  },
  ...shared("owner"),
];

export const ROUTES: readonly RouteCase[] = [
  ...MEMBER_ROUTES,
  ...OWNER_ROUTES,
].map((route) => ({
  ...route,
  title: route.title ?? `${route.heading} · Media`,
}));
