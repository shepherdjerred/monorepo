import { Menu } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { useEffect, useState } from "react";
import { ScoutMark } from "#src/brand/index.tsx";
import { Button } from "#src/components/button.tsx";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "#src/components/sheet.tsx";
import { ThemeMenu } from "#src/runtime/theme-menu.tsx";
import { cn } from "#src/lib/cn.ts";
import { surfaceHref as joinSurfaceHref } from "#src/layout/origins.ts";

export type ScoutSurfaceOrigins = {
  readonly app?: string | undefined;
  readonly docs?: string | undefined;
  readonly marketing?: string | undefined;
};

export function surfaceHref(
  origin: string | undefined,
  pathname: string,
): string {
  return joinSurfaceHref(origin, pathname);
}

export const MARKETING_NAV_LINKS = [
  {
    label: "Docs",
    href: "/docs/",
    surface: "docs",
    match: "prefix",
  },
  {
    label: "What’s New",
    href: "/whatsnew",
    surface: "marketing",
    match: "prefix",
  },
  {
    label: "Support",
    href: "/support",
    surface: "marketing",
    match: "prefix",
  },
] as const;

export function isNavLinkActive(
  currentPath: string | undefined,
  href: string,
  match: "exact" | "prefix",
): boolean {
  if (currentPath === undefined) return false;
  if (currentPath === href) return true;
  if (match === "exact") return false;
  const prefix = href.endsWith("/") ? href : `${href}/`;
  return currentPath.startsWith(prefix);
}

export function globalNavbarCta(signedIn: boolean | undefined): {
  label: "Dashboard" | "Get Started";
  href: "/app/" | "/app/login?returnTo=/app/";
} {
  return signedIn === true
    ? { label: "Dashboard", href: "/app/" }
    : { label: "Get Started", href: "/app/login?returnTo=/app/" };
}

export function parseNavbarSessionState(payload: unknown): boolean | undefined {
  if (typeof payload !== "object" || payload === null || !("result" in payload))
    return undefined;
  const result: unknown = payload.result;
  if (typeof result !== "object" || result === null || !("data" in result))
    return undefined;
  const data: unknown = result.data;
  if (typeof data !== "object" || data === null || !("user" in data))
    return undefined;
  const user: unknown = data.user;
  if (user === null) return false;
  return typeof user === "object" ? true : undefined;
}

export function useNavbarSessionState(): boolean {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function resolveSession(): Promise<void> {
      try {
        const response = await fetch("/trpc/auth.sessionState", {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const session = parseNavbarSessionState(await response.json());
        if (session !== undefined) setSignedIn(session);
      } catch {
        // An unavailable session endpoint intentionally keeps Get Started.
      }
    }
    void resolveSession();
    return () => {
      controller.abort();
    };
  }, []);

  return signedIn;
}

export function Container({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("scout-container", className)} {...props} />;
}
export function Stack({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("scout-stack", className)} {...props} />;
}
export function Cluster({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("scout-cluster", className)} {...props} />;
}
export function Grid({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("scout-grid", className)} {...props} />;
}
export function Section({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("scout-section", className)} {...props} />;
}
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("scout-panel", className)} {...props} />;
}
export function Callout({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <aside className={cn("scout-callout", className)} {...props} />;
}
export function PageHeader({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <header className={cn("scout-page-header", className)} {...props} />;
}
export function EmptyState({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("scout-empty-state scout-panel", className)}
      {...props}
    />
  );
}

function MarketingNavLinks(props: {
  currentPath?: string | undefined;
  origins?: ScoutSurfaceOrigins | undefined;
}) {
  return (
    <>
      {MARKETING_NAV_LINKS.map((link) => (
        <a
          key={link.href}
          href={surfaceHref(props.origins?.[link.surface], link.href)}
          className="scout-navbar__link"
          aria-current={
            isNavLinkActive(props.currentPath, link.href, link.match)
              ? "page"
              : undefined
          }
        >
          {link.label}
        </a>
      ))}
    </>
  );
}

function SessionCta(props: {
  signedIn?: boolean | undefined;
  getStartedTrackingEvent?: string | undefined;
  getStartedLocation?: string | undefined;
  origins?: ScoutSurfaceOrigins | undefined;
}) {
  const cta = globalNavbarCta(props.signedIn);
  return (
    <Button asChild size="sm">
      <a
        href={surfaceHref(props.origins?.app, cta.href)}
        data-scout-conversion={
          props.signedIn === true ? undefined : props.getStartedTrackingEvent
        }
        data-scout-cta-location={
          props.signedIn === true ? undefined : props.getStartedLocation
        }
      >
        {cta.label}
      </a>
    </Button>
  );
}

function MobileNavigation(props: {
  children: ReactNode;
  label: string;
  title?: ReactNode | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="scout-mobile-nav">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={props.label}>
            <Menu size={20} aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent
          className="scout-navigation-sheet"
          onClick={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest("a") !== null) {
              setOpen(false);
            }
          }}
          onChange={(event) => {
            if (event.target instanceof HTMLSelectElement) setOpen(false);
          }}
        >
          <SheetTitle>{props.title ?? <ScoutMark />}</SheetTitle>
          {props.children}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function MarketingHeader(props: {
  landmark?: "header" | "div";
  signedIn?: boolean | undefined;
  currentPath?: string | undefined;
  getStartedTrackingEvent?: string | undefined;
  getStartedLocation?: string | undefined;
  origins?: ScoutSurfaceOrigins | undefined;
}) {
  const Landmark = props.landmark ?? "header";
  return (
    <Landmark className="scout-navbar scout-marketing-header">
      <Container className="scout-navbar__inner">
        <a
          href={surfaceHref(props.origins?.marketing, "/")}
          aria-label="Scout home"
        >
          <ScoutMark />
        </a>
        <nav className="scout-navbar__links" aria-label="Global">
          <MarketingNavLinks
            currentPath={props.currentPath}
            origins={props.origins}
          />
        </nav>
        <div className="scout-navbar__utility">
          <ThemeMenu />
          <SessionCta
            signedIn={props.signedIn}
            getStartedTrackingEvent={props.getStartedTrackingEvent}
            getStartedLocation={props.getStartedLocation}
            origins={props.origins}
          />
          <MobileNavigation label="Open navigation">
            <nav className="scout-stack" aria-label="Mobile">
              <MarketingNavLinks
                currentPath={props.currentPath}
                origins={props.origins}
              />
            </nav>
          </MobileNavigation>
        </div>
      </Container>
    </Landmark>
  );
}

export function DocsHeader(props: {
  landmark?: "header" | "div";
  signedIn?: boolean | undefined;
  search?: ReactNode | undefined;
  origins?: ScoutSurfaceOrigins | undefined;
}) {
  const Landmark = props.landmark ?? "header";
  return (
    <Landmark className="scout-navbar scout-docs-header">
      <Container className="scout-navbar__inner">
        <div className="scout-docs-header__brand">
          <a
            href={surfaceHref(props.origins?.marketing, "/")}
            aria-label="Scout home"
          >
            <ScoutMark />
          </a>
          <span className="scout-docs-header__divider" aria-hidden="true" />
          <a
            href={surfaceHref(props.origins?.docs, "/docs/")}
            className="scout-docs-header__label"
          >
            Docs
          </a>
        </div>
        <div className="scout-docs-header__search">{props.search}</div>
        <div className="scout-navbar__utility">
          <ThemeMenu />
          <SessionCta signedIn={props.signedIn} origins={props.origins} />
        </div>
      </Container>
    </Landmark>
  );
}

export function AppHeader(props: {
  accountMenu?: ReactNode | undefined;
  mobileNavigation?: ReactNode | undefined;
  origins?: ScoutSurfaceOrigins | undefined;
}) {
  return (
    <header className="scout-navbar scout-app-header">
      <Container className="scout-navbar__inner">
        <a
          href={surfaceHref(props.origins?.app, "/app/")}
          aria-label="Scout dashboard"
        >
          <ScoutMark />
        </a>
        <div className="scout-navbar__utility">
          <a
            href={surfaceHref(props.origins?.docs, "/docs/")}
            className="scout-navbar__link scout-app-header__docs"
          >
            Docs
          </a>
          <ThemeMenu />
          {props.accountMenu}
          {props.mobileNavigation === undefined ? null : (
            <MobileNavigation label="Open app navigation" title={<ScoutMark />}>
              {props.mobileNavigation}
            </MobileNavigation>
          )}
        </div>
      </Container>
    </header>
  );
}

export function GlobalFooter(props: {
  release?: string | undefined;
  commit?: string | undefined;
  origins?: ScoutSurfaceOrigins | undefined;
}) {
  return (
    <footer className="scout-footer">
      <Container className="scout-stack">
        <div className="scout-footer__links">
          <a href={surfaceHref(props.origins?.marketing, "/privacy")}>
            Privacy
          </a>
          <a href={surfaceHref(props.origins?.marketing, "/tos")}>Terms</a>
          <a href={surfaceHref(props.origins?.marketing, "/support")}>
            Support
          </a>
          <a href="https://github.com/shepherdjerred/monorepo/tree/main/packages/scout-for-lol">
            GitHub
          </a>
        </div>
        <p>Scout is an independent League of Legends companion.</p>
        <p>
          Scout isn’t endorsed by Riot Games and doesn’t reflect the views or
          opinions of Riot Games or anyone officially involved in producing or
          managing Riot Games properties. Riot Games and all associated
          properties are trademarks or registered trademarks of Riot Games, Inc.
        </p>
        {props.release === undefined && props.commit === undefined ? null : (
          <p>
            Release {props.release ?? "local"}
            {props.commit === undefined ? "" : ` · ${props.commit}`}
          </p>
        )}
      </Container>
    </footer>
  );
}

export function AppWorkspaceFrame(props: {
  header: ReactNode;
  notice?: ReactNode | undefined;
  sidebar?: ReactNode | undefined;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="scout-page-frame">
      {props.header}
      <div className="scout-app-stage">
        {props.notice}
        <div
          className={cn(
            "scout-app-layout",
            props.sidebar === undefined && "scout-app-layout--focused",
          )}
        >
          {props.sidebar === undefined ? null : (
            <aside
              className="scout-app-sidebar"
              aria-label="Workspace navigation"
            >
              {props.sidebar}
            </aside>
          )}
          <main className="scout-app-content">{props.children}</main>
        </div>
      </div>
      {props.footer}
    </div>
  );
}
