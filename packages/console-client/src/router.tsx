import type { ReactElement, ReactNode } from "react";
import {
  Link,
  type AnyRouter,
  type RouterEvents,
} from "@tanstack/react-router";
import { z } from "zod";

/**
 * What console-ui hands a `renderLink` (its `RenderLinkProps`, also exported
 * as `SidebarLinkProps`), declared here structurally so the kit does not pin a
 * console-ui version.
 */
export type ConsoleLinkProps = {
  readonly href: string;
  readonly className: string;
  readonly "aria-current": "page" | undefined;
  readonly children: ReactNode;
  readonly onClick?: () => void;
};

export type ConsoleRouterLinkOptions = {
  /** Only the exact path is current, not its children. @default false */
  readonly exact?: boolean;
  /** The search must match too. @default false */
  readonly includeSearch?: boolean;
};

/**
 * A console-ui `renderLink` that renders TanStack Router's `<Link>`: client
 * navigation, intent preloading, and `aria-current="page"` whenever the link's
 * route is active (or the item is marked current).
 */
export function consoleRouterLink(
  options: ConsoleRouterLinkOptions = {},
): (props: ConsoleLinkProps) => ReactElement {
  const activeOptions = {
    exact: options.exact ?? false,
    includeSearch: options.includeSearch ?? false,
  };
  return function renderRouterLink(props) {
    return (
      // `AnyRouter` lets a console-ui href through whatever routes the app
      // registered; the link still resolves against the live router.
      <Link<AnyRouter, string, string>
        to={props.href}
        className={props.className}
        activeOptions={activeOptions}
        // No `active` class: console-ui styles `[aria-current="page"]`.
        activeProps={{}}
        {...(props["aria-current"] === undefined
          ? {}
          : { "aria-current": props["aria-current"] })}
        {...(props.onClick === undefined ? {} : { onClick: props.onClick })}
      >
        {props.children}
      </Link>
    );
  };
}

export type FocusTargets =
  | readonly string[]
  | ((event: RouterEvents["onResolved"]) => readonly string[]);

/**
 * Focus the first of these elements the page has. The new page is rendered
 * before the router reports it resolved, so focus moves at once, for a click
 * and for Enter on a link alike, and in a tab that runs no animation frames.
 * A frame later it only repeats the move when the element it focused has
 * since been replaced, so a reader who has tabbed on is never pulled back.
 * (Lifted from Delivery's router.)
 */
export function moveFocus(targets: readonly string[]): void {
  for (const target of targets) {
    const element = document.querySelector<HTMLElement>(target);
    if (element === null) continue;
    element.focus();
    requestAnimationFrame(() => {
      if (!element.isConnected) moveFocus(targets);
    });
    return;
  }
}

/**
 * After every navigation but the first load, move focus to the new page's
 * heading so screen readers announce it. An array applies when the path
 * changed; a function decides for every resolved navigation (Delivery also
 * focuses its list heading when only the page of a list changed). Call it
 * once where the router is created; it returns the unsubscribe.
 */
export function focusOnNavigate(
  router: AnyRouter,
  targets: FocusTargets = ["#main-heading"],
): () => void {
  let initial = true;
  return router.subscribe("onResolved", (event) => {
    if (initial) {
      initial = false;
      return;
    }
    const selected =
      typeof targets === "function"
        ? targets(event)
        : event.pathChanged
          ? targets
          : [];
    if (selected.length > 0) moveFocus(selected);
  });
}

/**
 * Search params come from hand-edited URLs, so a value of the wrong type is
 * dropped instead of failing the route (Delivery's `lenient`).
 */
export function lenient<T extends z.ZodType>(schema: T) {
  return z
    .unknown()
    .transform((value): z.infer<T> | undefined => schema.safeParse(value).data)
    .optional();
}

/**
 * A `validateSearch` for a route: every key is optional, a key whose value
 * does not parse is dropped (the rest are kept), and unknown keys are
 * stripped. The result is typed for `Route.useSearch()`.
 */
export function zodSearch<TShape extends z.ZodRawShape>(shape: TShape) {
  const schema = z.object(shape).partial();
  return (search: Record<string, unknown>): z.output<typeof schema> => {
    const parsed = schema.safeParse(search);
    if (parsed.success) return parsed.data;
    const invalid = new Set(parsed.error.issues.map((issue) => issue.path[0]));
    const valid = Object.fromEntries(
      Object.entries(search).filter(([key]) => !invalid.has(key)),
    );
    return schema.parse(valid);
  };
}
