import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

/**
 * The client half of a module: a self-contained area of the app with its own
 * pages, navigation, commands, search, and Home cards. The composition root
 * (`src/client/modules.ts`) lists every module; the router, the shell, the
 * command palette, and Home are all driven from that list.
 */
export type ClientModule = {
  /** Stable kebab-case identity, shared with the module's server half. */
  readonly id: string;
  readonly title: string;
  readonly icon: LucideIcon;
  /**
   * URL prefix every route and nav entry of the module sits under: `""` for
   * the core module, `/<segment>` for every other module.
   */
  readonly basePath: string;
  readonly routes: readonly ModuleRoute[];
  readonly nav: readonly ModuleNavItem[];
  readonly commands?: readonly ModuleCommand[];
  readonly search?: ModuleSearch;
  readonly homeCards?: readonly ModuleHomeCard[];
};

export type ModuleRoute = {
  /** Relative to the module's `basePath`; `""` is the module's index page. */
  readonly path: string;
  readonly page: ComponentType;
  /** `bare` renders the page without the app shell. Defaults to `shell`. */
  readonly chrome?: "shell" | "bare";
};

export type ModuleNavItem = {
  /** The name shown under the group heading, such as "Active". */
  readonly label: string;
  /**
   * The full name used where the group is not shown, such as "Active alerts"
   * in the command palette. Defaults to `label`.
   */
  readonly title?: string;
  /**
   * Heading the navigation lists the entry under. Entries of every module
   * with the same group share one heading. Defaults to the module's `title`.
   */
  readonly group?: string;
  readonly icon: LucideIcon;
  /** Relative to the module's `basePath`, like a route path. */
  readonly path: string;
  /** Extra words the command palette matches besides the label and group. */
  readonly keywords?: readonly string[];
};

export type ModuleCommandContext = {
  readonly navigate: (to: string) => void;
};

export type ModuleCommand = {
  /** Unique within the module. */
  readonly id: string;
  readonly label: string;
  readonly icon?: LucideIcon;
  /** Extra words the palette matches besides the label. */
  readonly keywords?: readonly string[];
  readonly run: (context: ModuleCommandContext) => void | Promise<void>;
};

export type ModuleSearchResult = {
  /** Unique within the module's results. */
  readonly id: string;
  /** Heading the palette lists the result under, such as "Services". */
  readonly group: string;
  readonly label: string;
  readonly detail?: string;
  /** In-app path the result opens. */
  readonly to: string;
};

/**
 * Asynchronous search over the module's own data. The palette debounces the
 * query and aborts the signal when a newer query replaces it.
 */
export type ModuleSearch = (
  query: string,
  signal: AbortSignal,
) => Promise<readonly ModuleSearchResult[]>;

export type ModuleHomeCard = {
  /** Unique within the module. */
  readonly id: string;
  /**
   * Renders one self-contained block on Home, including its own loading and
   * error states. May be lazy; Home gives each card its own Suspense boundary.
   */
  readonly card: ComponentType;
};

export type ResolvedRoute = {
  readonly moduleId: string;
  /** Absolute route pattern, such as `/services/:id`. */
  readonly path: string;
  readonly page: ComponentType;
  readonly chrome: "shell" | "bare";
};

export type ResolvedNavItem = {
  readonly moduleId: string;
  readonly label: string;
  readonly title: string;
  readonly group: string;
  readonly icon: LucideIcon;
  /** Absolute link target. */
  readonly to: string;
  readonly keywords?: readonly string[];
};

export type ResolvedNavGroup = {
  readonly label: string;
  readonly items: readonly ResolvedNavItem[];
};

export type ModuleRegistry = {
  readonly modules: readonly ClientModule[];
  readonly routes: readonly ResolvedRoute[];
  /** Every nav entry in declaration order; the command palette lists these. */
  readonly nav: readonly ResolvedNavItem[];
  /** The same entries under their group headings, in first-appearance order. */
  readonly navGroups: readonly ResolvedNavGroup[];
};

/** The one module allowed to own the root of the URL space. */
export const CORE_MODULE_ID = "core";

/**
 * Top-level URL segments the server answers itself, so no module may claim
 * them as a `basePath`.
 */
const SERVER_SEGMENTS: ReadonlySet<string> = new Set([
  "api",
  "assets",
  "healthz",
  "internal",
  "metrics",
  "readyz",
  "trpc",
]);

const MODULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BASE_PATH = /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Join a module `basePath` and a relative path into an absolute path. */
export function modulePath(basePath: string, path: string): string {
  if (path === "") return basePath === "" ? "/" : basePath;
  return `${basePath}/${path}`;
}

function firstSegment(path: string): string {
  return path.split("/")[1] ?? "";
}

function checkIdentity(module: ClientModule, seenIds: Set<string>): void {
  if (!MODULE_ID.test(module.id))
    throw new Error(`Module id "${module.id}" is not kebab-case`);
  if (seenIds.has(module.id))
    throw new Error(`Duplicate module id "${module.id}"`);
  seenIds.add(module.id);
  if (module.id === CORE_MODULE_ID) {
    if (module.basePath !== "")
      throw new Error(`The core module must use basePath ""`);
    return;
  }
  if (!BASE_PATH.test(module.basePath))
    throw new Error(
      `Module "${module.id}" needs a basePath of the form "/segment"; only the core module may use ""`,
    );
  if (SERVER_SEGMENTS.has(firstSegment(module.basePath)))
    throw new Error(
      `Module "${module.id}" basePath "${module.basePath}" is served by the server`,
    );
}

function checkRelativePath(module: ClientModule, path: string): void {
  if (path.startsWith("/") || path.endsWith("/") || path.includes("*"))
    throw new Error(
      `Module "${module.id}" path "${path}" must be relative, without a trailing slash or wildcard`,
    );
}

/**
 * Validate a module list and flatten it into absolute routes and nav entries.
 * A broken composition fails at startup rather than as a route that silently
 * shadows another or a nav link that leads nowhere.
 */
export function resolveModules(
  modules: readonly ClientModule[],
): ModuleRegistry {
  const seenIds = new Set<string>();
  for (const module of modules) checkIdentity(module, seenIds);
  const routes = resolveRoutes(modules);
  checkBasePaths(modules, routes);
  const nav = resolveNav(modules, routes);
  return { modules, routes, nav, navGroups: groupNav(nav) };
}

function resolveRoutes(modules: readonly ClientModule[]): ResolvedRoute[] {
  const owners = new Map<string, string>();
  return modules.flatMap((module) =>
    module.routes.map((route) => {
      checkRelativePath(module, route.path);
      const path = modulePath(module.basePath, route.path);
      const owner = owners.get(path);
      if (owner !== undefined)
        throw new Error(
          `Route "${path}" is declared by both "${owner}" and "${module.id}"`,
        );
      owners.set(path, module.id);
      return {
        moduleId: module.id,
        path,
        page: route.page,
        chrome: route.chrome ?? "shell",
      };
    }),
  );
}

function resolveNav(
  modules: readonly ClientModule[],
  routes: readonly ResolvedRoute[],
): ResolvedNavItem[] {
  const routePaths = new Set(routes.map((route) => route.path));
  const owners = new Map<string, string>();
  return modules.flatMap((module) =>
    module.nav.map((item) => {
      checkRelativePath(module, item.path);
      const group = item.group ?? module.title;
      if (group.trim() === "")
        throw new Error(
          `Module "${module.id}" nav entry "${item.label}" has a blank group`,
        );
      const to = modulePath(module.basePath, item.path);
      if (!routePaths.has(to))
        throw new Error(
          `Nav entry "${to}" of "${module.id}" points at no declared route`,
        );
      const owner = owners.get(to);
      if (owner !== undefined)
        throw new Error(
          `Nav entry "${to}" is declared by both "${owner}" and "${module.id}"`,
        );
      owners.set(to, module.id);
      return {
        moduleId: module.id,
        label: item.label,
        title: item.title ?? item.label,
        group,
        icon: item.icon,
        to,
        ...(item.keywords === undefined ? {} : { keywords: item.keywords }),
      };
    }),
  );
}

function groupNav(nav: readonly ResolvedNavItem[]): ResolvedNavGroup[] {
  const groups = new Map<string, ResolvedNavItem[]>();
  for (const item of nav) {
    const items = groups.get(item.group) ?? [];
    items.push(item);
    groups.set(item.group, items);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}

/**
 * A module's basePath owns its whole first segment, so a core route under the
 * same segment would be split between two modules.
 */
function checkBasePaths(
  modules: readonly ClientModule[],
  routes: readonly ResolvedRoute[],
): void {
  const basePathOwners = new Map<string, string>();
  for (const module of modules) {
    if (module.id === CORE_MODULE_ID) continue;
    const owner = basePathOwners.get(module.basePath);
    if (owner !== undefined)
      throw new Error(
        `basePath "${module.basePath}" is claimed by both "${owner}" and "${module.id}"`,
      );
    basePathOwners.set(module.basePath, module.id);
  }
  for (const route of routes) {
    const owner = basePathOwners.get(`/${firstSegment(route.path)}`);
    if (owner !== undefined && owner !== route.moduleId)
      throw new Error(
        `Route "${route.path}" of "${route.moduleId}" sits under the basePath of "${owner}"`,
      );
  }
}
