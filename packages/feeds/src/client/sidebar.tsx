import type { MouseEvent } from "react";
import {
  ActivityIcon,
  CheckCheckIcon,
  FolderIcon,
  InboxIcon,
  ListIcon,
  PlusIcon,
  RefreshCwIcon,
  StarIcon,
} from "lucide-react";
import {
  AppSwitcher,
  Button,
  Field,
  HeaderBar,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  Tabs,
  ThemeRow,
  type SidebarLinkProps,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";
import type {
  CategorySummary,
  SummaryResponse,
} from "@shepherdjerred/feeds/shared/contract.ts";
import {
  formatRelativeTime,
  isSameNavTarget,
  routeHref,
  routePath,
  type Route,
} from "./model.ts";

const APPS = CONSOLE_LINKS.map(({ label, url, group }) => ({
  label,
  url,
  group,
}));

const CURRENT_APP = { label: "Feeds", mark: "R" } as const;

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function makeLinkRenderer(
  onNavigate: ((href: string) => void) | undefined,
): ((props: SidebarLinkProps) => React.JSX.Element) | undefined {
  if (onNavigate === undefined) return undefined;
  return function renderNavLink({
    href,
    className,
    "aria-current": ariaCurrent,
    children,
  }: SidebarLinkProps): React.JSX.Element {
    return (
      <a
        href={href}
        className={className}
        aria-current={ariaCurrent}
        onClick={(event) => {
          if (isPlainLeftClick(event)) {
            event.preventDefault();
            onNavigate(href);
          }
        }}
      >
        {children}
      </a>
    );
  };
}

function countProp(value: number | undefined): { readonly count?: number } {
  return value === undefined ? {} : { count: value };
}

export type FeedsSidebarProps = {
  readonly summary: SummaryResponse | undefined;
  readonly route: Route | undefined;
  readonly theme: ThemeStore;
  readonly status?: string | undefined;
  readonly failure?: string | undefined;
  readonly onNavigate?: ((href: string) => void) | undefined;
};

export function FeedsSidebar({
  summary,
  route,
  theme,
  status,
  failure,
  onNavigate,
}: FeedsSidebarProps): React.JSX.Element {
  const categories: readonly CategorySummary[] = summary?.categories ?? [];
  const failingCount =
    summary !== undefined && summary.stats.failingFeeds > 0
      ? summary.stats.failingFeeds
      : undefined;
  const renderLink = makeLinkRenderer(onNavigate);
  const linkProp = renderLink === undefined ? {} : { renderLink };

  return (
    <Sidebar
      top={<AppSwitcher current={CURRENT_APP} apps={APPS} />}
      navLabel="Feeds navigation"
      label="Feeds"
      footer={<ThemeRow store={theme} />}
    >
      {status === undefined ? null : <p className="fd-note">{status}</p>}
      {failure === undefined ? null : (
        <p className="fd-note" role="alert">
          {failure}
        </p>
      )}
      <SidebarGroup label="Views">
        <SidebarItem
          href="/"
          label="Unread"
          icon={InboxIcon}
          {...countProp(summary?.views.unread)}
          current={isSameNavTarget(route, { kind: "entries", view: "unread" })}
          {...linkProp}
        />
        <SidebarItem
          href="/all"
          label="All"
          icon={ListIcon}
          current={isSameNavTarget(route, { kind: "entries", view: "all" })}
          {...linkProp}
        />
        <SidebarItem
          href="/starred"
          label="Starred"
          icon={StarIcon}
          {...countProp(summary?.views.starred)}
          current={isSameNavTarget(route, { kind: "entries", view: "starred" })}
          {...linkProp}
        />
        <SidebarItem
          href="/auto-read"
          label="Auto-read"
          icon={CheckCheckIcon}
          {...countProp(summary?.views.autoRead)}
          current={isSameNavTarget(route, {
            kind: "entries",
            view: "auto-read",
          })}
          {...linkProp}
        />
        <SidebarItem
          href="/feeds"
          label="Feeds & Health"
          icon={ActivityIcon}
          {...countProp(failingCount)}
          current={isSameNavTarget(route, { kind: "feeds" })}
          {...linkProp}
        />
      </SidebarGroup>
      {categories.length === 0 ? null : (
        <SidebarGroup label="Categories">
          {categories.map((category) => (
            <SidebarItem
              key={category.id}
              href={`/category/${encodeURIComponent(category.label)}`}
              label={category.label}
              icon={FolderIcon}
              count={category.unreadCount}
              current={isSameNavTarget(route, {
                kind: "entries",
                view: "unread",
                category: category.label,
              })}
              {...linkProp}
            />
          ))}
        </SidebarGroup>
      )}
    </Sidebar>
  );
}

export type FeedsPickerProps = {
  readonly summary: SummaryResponse | undefined;
  readonly route: Route | undefined;
  readonly activeFeedTitle?: string | undefined;
  readonly onNavigate?: ((href: string) => void) | undefined;
};

export function FeedsPicker({
  summary,
  route,
  activeFeedTitle,
  onNavigate,
}: FeedsPickerProps): React.JSX.Element {
  const categories = summary?.categories ?? [];
  const selectedHref = route === undefined ? "" : routePath(route);
  const feedRouteId =
    route?.kind === "entries" && route.feedId !== undefined
      ? route.feedId
      : undefined;

  return (
    <div className="ui-toolbar fd-picker">
      <AppSwitcher current={CURRENT_APP} apps={APPS} />
      <Field label="View" layout="inline">
        {(control) => (
          <select
            {...control}
            name="route"
            value={selectedHref}
            onChange={(event) => {
              const target = event.target.value;
              if (target.length === 0) return;
              if (onNavigate === undefined) {
                globalThis.location.assign(target);
              } else {
                onNavigate(target);
              }
            }}
          >
            {route === undefined ? <option value="">Choose…</option> : null}
            <optgroup label="Views">
              <option value="/">
                Unread
                {summary === undefined
                  ? ""
                  : ` (${String(summary.views.unread)})`}
              </option>
              <option value="/all">All</option>
              <option value="/starred">
                Starred
                {summary === undefined
                  ? ""
                  : ` (${String(summary.views.starred)})`}
              </option>
              <option value="/auto-read">
                Auto-read
                {summary === undefined
                  ? ""
                  : ` (${String(summary.views.autoRead)})`}
              </option>
              <option value="/feeds">
                Feeds &amp; Health
                {summary !== undefined && summary.stats.failingFeeds > 0
                  ? ` (${String(summary.stats.failingFeeds)} failing)`
                  : ""}
              </option>
            </optgroup>
            {categories.length === 0 ? null : (
              <optgroup label="Categories">
                {categories.map((category) => (
                  <option
                    key={category.id}
                    value={`/category/${encodeURIComponent(category.label)}`}
                  >
                    {category.label} ({String(category.unreadCount)})
                  </option>
                ))}
              </optgroup>
            )}
            {feedRouteId === undefined ? null : (
              <optgroup label="Filtered Feed">
                <option value={`/feed/${String(feedRouteId)}`}>
                  {activeFeedTitle ?? `Feed #${String(feedRouteId)}`}
                </option>
              </optgroup>
            )}
          </select>
        )}
      </Field>
    </div>
  );
}

function headerActions(options: {
  readonly route: Route | undefined;
  readonly hasEntries: boolean;
  readonly isRefreshing: boolean;
  readonly isMarkingRead: boolean;
  readonly onRefresh: () => void;
  readonly onMarkViewRead: () => void;
  readonly onAddFeed: () => void;
}): React.JSX.Element | undefined {
  if (options.route === undefined) return undefined;
  if (options.route.kind === "feeds") {
    return (
      <>
        <Button
          type="button"
          disabled={options.isRefreshing}
          onClick={options.onRefresh}
        >
          <RefreshCwIcon aria-hidden="true" />
          {options.isRefreshing ? "Refreshing…" : "Refresh now"}
        </Button>
        <Button type="button" variant="primary" onClick={options.onAddFeed}>
          <PlusIcon aria-hidden="true" />
          Add feed
        </Button>
      </>
    );
  }
  return (
    <>
      <Button
        type="button"
        disabled={!options.hasEntries || options.isMarkingRead}
        onClick={options.onMarkViewRead}
      >
        <CheckCheckIcon aria-hidden="true" />
        {options.isMarkingRead ? "Marking…" : "Mark view read"}
      </Button>
      <Button
        type="button"
        variant="primary"
        disabled={options.isRefreshing}
        onClick={options.onRefresh}
      >
        <RefreshCwIcon aria-hidden="true" />
        {options.isRefreshing ? "Refreshing…" : "Refresh now"}
      </Button>
    </>
  );
}

export function FeedsHeader({
  title,
  route,
  summary,
  query,
  hasEntries,
  isRefreshing,
  isMarkingRead,
  onNavigate,
  onRefresh,
  onMarkViewRead,
  onAddFeed,
}: {
  readonly title: string;
  readonly route: Route | undefined;
  readonly summary: SummaryResponse | undefined;
  readonly query: string;
  readonly hasEntries: boolean;
  readonly isRefreshing: boolean;
  readonly isMarkingRead: boolean;
  readonly onNavigate: (href: string) => void;
  readonly onRefresh: () => void;
  readonly onMarkViewRead: () => void;
  readonly onAddFeed: () => void;
}): React.JSX.Element {
  const category = route?.kind === "entries" ? route.category : undefined;
  const catSummary =
    category === undefined
      ? undefined
      : summary?.categories.find((cat) => cat.label === category);
  const tabs =
    category !== undefined && route?.kind === "entries" ? (
      <Tabs
        label="Category entries"
        options={[
          {
            value: "unread",
            label: "Unread",
            ...(catSummary === undefined
              ? {}
              : { count: catSummary.unreadCount }),
          },
          { value: "all", label: "All" },
        ]}
        value={route.view === "all" ? "all" : "unread"}
        onChange={(nextView) => {
          onNavigate(
            routeHref({ kind: "entries", view: nextView, category }, query),
          );
        }}
      />
    ) : undefined;
  const meta =
    summary === undefined
      ? undefined
      : `Last polled ${formatRelativeTime(summary.stats.lastPolledAt)}`;

  return (
    <HeaderBar
      title={title}
      tabs={tabs}
      meta={meta}
      actions={headerActions({
        route,
        hasEntries,
        isRefreshing,
        isMarkingRead,
        onRefresh,
        onMarkViewRead,
        onAddFeed,
      })}
    />
  );
}
