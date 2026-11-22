import type { Persona } from "#testing/fixture-api/personas.ts";
import { fixtureId } from "#testing/fixture-api/support.ts";
import {
  FEATURED,
  episodeId,
  seasonId,
  titleNamed,
} from "#testing/fixture-api/fixtures/titles.ts";

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
    // Home: the owner's also lists what a restore left for them to decide.
    { label: `${persona} /`, path: "/", heading: "Home" },
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
    { label: `${persona} /calendar`, path: "/calendar", heading: "Calendar" },
    {
      label: `${persona} /calendar?view=agenda`,
      path: "/calendar?view=agenda",
      heading: "Calendar",
    },
    {
      label: `${persona} /calendar?view=month`,
      path: "/calendar?view=month",
      heading: "Calendar",
    },
    {
      label: `${persona} /history`,
      path: "/history",
      heading: "History",
    },
    {
      label: `${persona} /notifications`,
      path: "/notifications",
      heading: "Notifications",
    },
    {
      label: `${persona} /notifications/settings`,
      path: "/notifications/settings",
      heading: "Notification settings",
    },
    // What a verification email and Discord link to. Each waits for its
    // reader before it writes, so opening one is only a page.
    {
      label: `${persona} /notifications/email`,
      path: "/notifications/email#verify=token",
      heading: "Confirm your email address",
    },
    {
      label: `${persona} /notifications/discord`,
      path: "/notifications/discord?code=abc&state=def",
      heading: "Connect your Discord account",
    },
    {
      // The owner's address for it is a Manage page; the member's stays.
      label: `${persona} /recovery`,
      path: "/recovery",
      heading: persona === "owner" ? "Recovery" : "Recovery reviews",
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
    {
      label: `${persona} /media/:season`,
      path: `/media/${seasonId(series, 2)}`,
      heading: "Season 2",
    },
    {
      label: `${persona} /media/:episode`,
      path: `/media/${episodeId(series, 2, 1)}`,
      heading: "Hello, Ms. Cobel",
    },
    {
      // A film with more than one version.
      label: `${persona} /media/:versions`,
      path: `/media/${titleNamed("Blade Runner").id}`,
      heading: "Blade Runner",
    },
    {
      // A film kept just for now: the owner is offered the keeping switch.
      label: `${persona} /media/:temporary`,
      path: `/media/${titleNamed("Alien").id}`,
      heading: "Alien",
    },
    {
      label: `${persona} /media/:leaving`,
      path: `/media/${titleNamed("The Expanse").id}`,
      heading: "The Expanse",
    },
    {
      label: `${persona} /media/:removed`,
      path: `/media/${FEATURED.quarantinedMovie.id}`,
      heading: FEATURED.quarantinedMovie.title,
    },
    {
      // Titles the household does not have.
      label: `${persona} /catalog/movie/:outside`,
      path: "/catalog/movie/155",
      heading: "The Dark Knight",
    },
    {
      label: `${persona} /catalog/series/:outside`,
      path: "/catalog/series/1398",
      heading: "The Sopranos",
    },
  ].map((route) => ({ ...route, persona }));
}

/** A household review as a member opens it, and as the owner does. */
const REVIEW_HEADING = "Review protected titles";

/**
 * Every route a household member can open from navigation or a list.
 *
 * Not covered, because the read-only fixture API cannot answer it: the movie
 * edition review `/recovery/movies/:id` (its detail contract has no fixture
 * yet).
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
    heading: "Your request",
  },
  {
    label: "member /recovery/:id",
    persona: "member",
    path: `/recovery/${fixtureId(16, 1)}`,
    heading: REVIEW_HEADING,
  },
  {
    label: "member /recovery/:id (applied)",
    persona: "member",
    path: `/recovery/${fixtureId(16, 2)}`,
    heading: REVIEW_HEADING,
  },
  ...shared("member"),
];

/** One review of each kind as the owner opens it: waiting on a household, applied, a long one, one that cannot be applied, and one ready to apply. */
const OWNER_REVIEW_ROUTES: readonly RouteSpec[] = [1, 2, 4, 5, 6].map((n) => ({
  label: `owner /recovery/:id (${String(n)})`,
  persona: "owner" as const,
  path: `/recovery/${fixtureId(16, n)}`,
  heading: REVIEW_HEADING,
}));

/** The owner's view of a title: the operator panels behind its Manage switch. */
const TITLE_MANAGE_ROUTES: readonly RouteSpec[] = [
  {
    label: "owner /media/:movie?view=manage",
    persona: "owner",
    path: `/media/${movie.id}?view=manage`,
    heading: movie.title,
  },
  {
    label: "owner /media/:series?view=manage",
    persona: "owner",
    path: `/media/${series.id}?view=manage`,
    heading: series.title,
  },
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
  ...TITLE_MANAGE_ROUTES,
  ...OWNER_REVIEW_ROUTES,
  ...shared("owner"),
];

export const ROUTES: readonly RouteCase[] = [
  ...MEMBER_ROUTES,
  ...OWNER_ROUTES,
].map((route) => ({
  ...route,
  title: route.title ?? `${route.heading} · Media`,
}));
