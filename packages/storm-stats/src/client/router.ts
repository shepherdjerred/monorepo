import { useSyncExternalStore } from "react";
import {
  ActivityGroupSchema,
  PlatformSchema,
  PlayerSortFieldSchema,
  type ActivityGroup,
  type Platform,
  type PlayerSortField,
} from "@shepherdjerred/storm-stats/shared/contract.ts";

export type SortDir = "asc" | "desc";

export type PlayersRouteQuery = {
  readonly q: string;
  readonly group: ActivityGroup | "all";
  readonly platform: Platform | "all";
  readonly sort: PlayerSortField;
  readonly dir: SortDir;
  readonly page: number;
  readonly pageSize: number;
};

export type StaffQueryFilters = {
  readonly registeredAfter: string;
  readonly registeredBefore: string;
  readonly lastSeenAfter: string;
  readonly lastSeenBefore: string;
  readonly minPlaytimeHours: string;
  readonly maxPlaytimeHours: string;
  readonly activityGroups: readonly ActivityGroup[];
  readonly platform: Platform | "all";
  readonly primaryGroup: string;
  readonly town: string;
  readonly joinAddress: string;
  readonly countryCode: string;
  readonly hasBounce: boolean;
};

export const DEFAULT_PLAYERS_QUERY: PlayersRouteQuery = {
  q: "",
  group: "all",
  platform: "all",
  sort: "activePlaytime",
  dir: "desc",
  page: 1,
  pageSize: 25,
};

export const DEFAULT_STAFF_QUERY_FILTERS: StaffQueryFilters = {
  registeredAfter: "",
  registeredBefore: "",
  lastSeenAfter: "",
  lastSeenBefore: "",
  minPlaytimeHours: "",
  maxPlaytimeHours: "",
  activityGroups: [],
  platform: "all",
  primaryGroup: "",
  town: "",
  joinAddress: "",
  countryCode: "",
  hasBounce: false,
};

export type AppRoute =
  | { readonly kind: "overview" }
  | { readonly kind: "activity" }
  | { readonly kind: "players"; readonly query: PlayersRouteQuery }
  | { readonly kind: "player"; readonly id: string }
  | { readonly kind: "pvp" }
  | { readonly kind: "gameplay" }
  | { readonly kind: "staff-network" }
  | { readonly kind: "staff-bounces" }
  | { readonly kind: "staff-query"; readonly filters: StaffQueryFilters }
  | { readonly kind: "not-found"; readonly pathname: string };

function parsePositiveInt(
  raw: string | null,
  fallback: number,
  max: number,
): number {
  if (raw === null || raw.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return !Number.isFinite(parsed) || parsed < 1
    ? fallback
    : Math.min(parsed, max);
}

export function parsePlayersQuery(search: string): PlayersRouteQuery {
  const params = new URLSearchParams(search);
  const q = (params.get("q") ?? "").trim();
  const groupParsed = ActivityGroupSchema.safeParse(params.get("group"));
  const platformParsed = PlatformSchema.safeParse(params.get("platform"));
  const sortParsed = PlayerSortFieldSchema.safeParse(params.get("sort"));
  const rawDir = params.get("dir");
  const dir: SortDir = rawDir === "asc" ? "asc" : "desc";
  const page = parsePositiveInt(params.get("page"), 1, 10_000);
  const pageSize = parsePositiveInt(params.get("pageSize"), 25, 100);

  return {
    q,
    group: groupParsed.success ? groupParsed.data : "all",
    platform: platformParsed.success ? platformParsed.data : "all",
    sort: sortParsed.success ? sortParsed.data : "activePlaytime",
    dir,
    page,
    pageSize,
  };
}

function parseActivityGroupsParam(params: URLSearchParams): ActivityGroup[] {
  const rawValues = params.getAll("activityGroups");
  const seen = new Set<ActivityGroup>();
  for (const raw of rawValues) {
    for (const token of raw.split(",")) {
      const parsed = ActivityGroupSchema.safeParse(token.trim());
      if (parsed.success) {
        seen.add(parsed.data);
      }
    }
  }
  return [...seen];
}

export function parseStaffQueryFilters(search: string): StaffQueryFilters {
  const params = new URLSearchParams(search);
  const platformParsed = PlatformSchema.safeParse(params.get("platform"));
  const hasBounceRaw = params.get("hasBounce");

  return {
    registeredAfter: (params.get("registeredAfter") ?? "").trim(),
    registeredBefore: (params.get("registeredBefore") ?? "").trim(),
    lastSeenAfter: (params.get("lastSeenAfter") ?? "").trim(),
    lastSeenBefore: (params.get("lastSeenBefore") ?? "").trim(),
    minPlaytimeHours: (params.get("minPlaytimeHours") ?? "").trim(),
    maxPlaytimeHours: (params.get("maxPlaytimeHours") ?? "").trim(),
    activityGroups: parseActivityGroupsParam(params),
    platform: platformParsed.success ? platformParsed.data : "all",
    primaryGroup: (params.get("primaryGroup") ?? "").trim(),
    town: (params.get("town") ?? "").trim(),
    joinAddress: (params.get("joinAddress") ?? "").trim(),
    countryCode: (params.get("countryCode") ?? "").trim().toUpperCase(),
    hasBounce: hasBounceRaw === "true" || hasBounceRaw === "1",
  };
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseRoute(pathname: string, search = ""): AppRoute {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  const first = parts[0];
  if (first === undefined) {
    return { kind: "overview" };
  }
  if (parts.length === 1) {
    switch (first) {
      case "activity":
        return { kind: "activity" };
      case "players":
        return { kind: "players", query: parsePlayersQuery(search) };
      case "pvp":
        return { kind: "pvp" };
      case "gameplay":
        return { kind: "gameplay" };
      default:
        return { kind: "not-found", pathname };
    }
  }
  const second = parts[1];
  if (first === "player" && second !== undefined && parts.length === 2) {
    const decoded = decodeSegment(second).trim();
    if (decoded.length > 0) {
      return { kind: "player", id: decoded };
    }
  }
  if (first === "staff" && second !== undefined && parts.length === 2) {
    switch (second) {
      case "network":
        return { kind: "staff-network" };
      case "bounces":
        return { kind: "staff-bounces" };
      case "query":
        return { kind: "staff-query", filters: parseStaffQueryFilters(search) };
      default:
        return { kind: "not-found", pathname };
    }
  }
  return { kind: "not-found", pathname };
}

export function buildPlayersSearchParams(
  query: PlayersRouteQuery,
  omitDefaults: boolean,
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q.length > 0) {
    params.set("q", query.q);
  }
  if (query.group !== "all") {
    params.set("group", query.group);
  }
  if (query.platform !== "all") {
    params.set("platform", query.platform);
  }
  if (!omitDefaults || query.sort !== "activePlaytime") {
    params.set("sort", query.sort);
  }
  if (!omitDefaults || query.dir !== "desc") {
    params.set("dir", query.dir);
  }
  if (!omitDefaults || query.page > 1) {
    params.set("page", String(query.page));
  }
  if (!omitDefaults || query.pageSize !== 25) {
    params.set("pageSize", String(query.pageSize));
  }
  return params;
}

export function buildPlayersSearch(query: PlayersRouteQuery): string {
  const serialized = buildPlayersSearchParams(query, true).toString();
  return serialized.length === 0 ? "" : `?${serialized}`;
}

export function buildStaffQuerySearch(filters: StaffQueryFilters): string {
  const params = new URLSearchParams();
  const pairs: readonly (readonly [string, string])[] = [
    ["registeredAfter", filters.registeredAfter],
    ["registeredBefore", filters.registeredBefore],
    ["lastSeenAfter", filters.lastSeenAfter],
    ["lastSeenBefore", filters.lastSeenBefore],
    ["minPlaytimeHours", filters.minPlaytimeHours],
    ["maxPlaytimeHours", filters.maxPlaytimeHours],
    ["primaryGroup", filters.primaryGroup],
    ["town", filters.town],
    ["joinAddress", filters.joinAddress],
    ["countryCode", filters.countryCode.toUpperCase()],
  ];
  for (const [key, val] of pairs) {
    if (val.trim().length > 0) {
      params.set(key, val.trim());
    }
  }
  if (filters.activityGroups.length > 0) {
    params.set("activityGroups", filters.activityGroups.join(","));
  }
  if (filters.platform !== "all") {
    params.set("platform", filters.platform);
  }
  if (filters.hasBounce) {
    params.set("hasBounce", "true");
  }
  const serialized = params.toString();
  return serialized.length === 0 ? "" : `?${serialized}`;
}

export function playerProfilePath(idOrName: string): string {
  return `/player/${encodeURIComponent(idOrName)}`;
}

export function buildRouteHref(route: AppRoute): string {
  switch (route.kind) {
    case "overview":
      return "/";
    case "activity":
      return "/activity";
    case "players":
      return `/players${buildPlayersSearch(route.query)}`;
    case "player":
      return playerProfilePath(route.id);
    case "pvp":
      return "/pvp";
    case "gameplay":
      return "/gameplay";
    case "staff-network":
      return "/staff/network";
    case "staff-bounces":
      return "/staff/bounces";
    case "staff-query":
      return `/staff/query${buildStaffQuerySearch(route.filters)}`;
    case "not-found":
      return route.pathname;
  }
}

export function getRoutePageTitle(route: AppRoute): string {
  switch (route.kind) {
    case "overview":
      return "Server Overview";
    case "activity":
      return "Online Activity & Retention";
    case "players":
      return "Players Directory";
    case "player":
      return `${route.id} · Player Profile`;
    case "pvp":
      return "PvP & PvE Combat";
    case "gameplay":
      return "Storm Gameplay";
    case "staff-network":
      return "Network & Geolocation (Staff)";
    case "staff-bounces":
      return "Joins & Bounces (Staff)";
    case "staff-query":
      return "Player Query Builder (Staff)";
    case "not-found":
      return "Page Not Found";
  }
}

export function formatDocumentTitle(pageTitle: string): string {
  return `${pageTitle} · The Storm Analytics`;
}

const HAS_BROWSER_LOCATION = "location" in globalThis;
const HAS_BROWSER_DOCUMENT = "document" in globalThis;
const HAS_BROWSER_HISTORY = "history" in globalThis;

const routeListeners = new Set<() => void>();
let routerInitialized = false;
let currentHref = "/";
let cachedRoute: AppRoute = { kind: "overview" };

export function setPageDocumentTitle(pageTitle: string): void {
  if (HAS_BROWSER_DOCUMENT) {
    document.title = formatDocumentTitle(pageTitle);
  }
}

function syncFromLocation(): void {
  if (!HAS_BROWSER_LOCATION) {
    return;
  }
  const nextHref = `${globalThis.location.pathname}${globalThis.location.search}`;
  const nextRoute = parseRoute(
    globalThis.location.pathname,
    globalThis.location.search,
  );
  setPageDocumentTitle(getRoutePageTitle(nextRoute));
  if (nextHref === currentHref) {
    return;
  }
  currentHref = nextHref;
  cachedRoute = nextRoute;
  for (const listener of routeListeners) {
    listener();
  }
}

function ensureRouterInitialized(): void {
  if (routerInitialized || !HAS_BROWSER_LOCATION) {
    return;
  }
  routerInitialized = true;
  currentHref = `${globalThis.location.pathname}${globalThis.location.search}`;
  cachedRoute = parseRoute(
    globalThis.location.pathname,
    globalThis.location.search,
  );
  setPageDocumentTitle(getRoutePageTitle(cachedRoute));
  if ("addEventListener" in globalThis) {
    globalThis.addEventListener("popstate", () => {
      syncFromLocation();
    });
  }
}

function subscribeRoute(listener: () => void): () => void {
  ensureRouterInitialized();
  routeListeners.add(listener);
  return () => {
    routeListeners.delete(listener);
  };
}

function getRouteSnapshot(): AppRoute {
  ensureRouterInitialized();
  return cachedRoute;
}

const SERVER_ROUTE: AppRoute = { kind: "overview" };
function getServerRouteSnapshot(): AppRoute {
  return SERVER_ROUTE;
}

export function navigate(
  href: string,
  options?: { readonly replace?: boolean; readonly preserveScroll?: boolean },
): void {
  if (!HAS_BROWSER_HISTORY || !HAS_BROWSER_LOCATION) {
    return;
  }
  ensureRouterInitialized();
  const previousPathname = globalThis.location.pathname;
  if (options?.replace === true) {
    globalThis.history.replaceState(null, "", href);
  } else {
    globalThis.history.pushState(null, "", href);
  }
  syncFromLocation();
  if (
    options?.preserveScroll !== true &&
    globalThis.location.pathname !== previousPathname &&
    "scrollTo" in globalThis
  ) {
    globalThis.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }
}

export function useRoute(): AppRoute {
  return useSyncExternalStore(
    subscribeRoute,
    getRouteSnapshot,
    getServerRouteSnapshot,
  );
}
