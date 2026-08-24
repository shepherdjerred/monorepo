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

export const SCOUT_NAV_LINKS = [
  { label: "Home", href: "/", surface: "marketing", match: "exact" },
  {
    label: "Documentation",
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

function NavLinks(props: {
  currentPath?: string | undefined;
  origins?: ScoutSurfaceOrigins | undefined;
}) {
  return (
    <>
      {SCOUT_NAV_LINKS.map((link) => (
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

export function GlobalNavbar(props: {
  landmark?: "header" | "div";
  signedIn?: boolean | undefined;
  currentPath?: string | undefined;
  utility?: ReactNode | undefined;
  mobileNavigation?: ReactNode | undefined;
  accountMenu?: ReactNode | undefined;
  guildAccess?: ReactNode | undefined;
  getStartedTrackingEvent?: string | undefined;
  getStartedLocation?: string | undefined;
  origins?: ScoutSurfaceOrigins | undefined;
}) {
  const Landmark = props.landmark ?? "header";
  const cta = globalNavbarCta(props.signedIn);
  return (
    <Landmark className="scout-navbar">
      <Container className="scout-navbar__inner">
        <a
          href={surfaceHref(props.origins?.marketing, "/")}
          aria-label="Scout home"
        >
          <ScoutMark />
        </a>
        <nav className="scout-navbar__links" aria-label="Global">
          <NavLinks currentPath={props.currentPath} origins={props.origins} />
        </nav>
        <div className="scout-navbar__utility">
          {props.utility}
          {props.guildAccess}
          <ThemeMenu />
          {props.signedIn === true ? props.accountMenu : null}
          <Button asChild size="sm">
            <a
              href={surfaceHref(props.origins?.app, cta.href)}
              data-scout-conversion={
                props.signedIn === true
                  ? undefined
                  : props.getStartedTrackingEvent
              }
              data-scout-cta-location={
                props.signedIn === true ? undefined : props.getStartedLocation
              }
            >
              {cta.label}
            </a>
          </Button>
          <div className="scout-mobile-nav">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open navigation"
                >
                  <Menu size={20} aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetTitle>
                  <ScoutMark />
                </SheetTitle>
                <nav className="scout-stack" aria-label="Mobile">
                  <NavLinks
                    currentPath={props.currentPath}
                    origins={props.origins}
                  />
                  {props.mobileNavigation}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </Container>
    </Landmark>
  );
}

export function ProductSubnavigation(props: { children: ReactNode }) {
  return (
    <nav className="scout-product-nav" aria-label="Product">
      <Container className="scout-cluster">{props.children}</Container>
    </nav>
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

export function ResponsivePageFrame(props: {
  navbar: ReactNode;
  subnav?: ReactNode | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
}) {
  return (
    <div className="scout-page-frame">
      <div>
        {props.navbar}
        {props.subnav}
      </div>
      <main>{props.children}</main>
      {props.footer}
    </div>
  );
}

export function PublicShell(props: {
  children: ReactNode;
  currentPath?: string | undefined;
  utility?: ReactNode | undefined;
  release?: string | undefined;
  commit?: string | undefined;
  origins?: ScoutSurfaceOrigins | undefined;
}) {
  return (
    <ResponsivePageFrame
      navbar={
        <GlobalNavbar
          currentPath={props.currentPath}
          utility={props.utility}
          origins={props.origins}
        />
      }
      footer={
        <GlobalFooter
          release={props.release}
          commit={props.commit}
          origins={props.origins}
        />
      }
    >
      {props.children}
    </ResponsivePageFrame>
  );
}

export function AppShell(props: {
  children: ReactNode;
  currentPath?: string | undefined;
  signedIn: boolean;
  accountMenu?: ReactNode | undefined;
  guildAccess?: ReactNode | undefined;
  productSubnav?: ReactNode | undefined;
  origins?: ScoutSurfaceOrigins | undefined;
}) {
  return (
    <ResponsivePageFrame
      navbar={
        <GlobalNavbar
          currentPath={props.currentPath}
          signedIn={props.signedIn}
          accountMenu={props.accountMenu}
          guildAccess={props.guildAccess}
          origins={props.origins}
        />
      }
      subnav={props.productSubnav}
    >
      {props.children}
    </ResponsivePageFrame>
  );
}

export function DocsAdapter(props: {
  search?: ReactNode | undefined;
  mobileSidebar?: ReactNode | undefined;
  origins?: ScoutSurfaceOrigins | undefined;
}) {
  return (
    <GlobalNavbar
      currentPath="/docs/"
      origins={props.origins}
      utility={
        <>
          {props.search}
          {props.mobileSidebar}
        </>
      }
    />
  );
}
