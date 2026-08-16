import { Menu } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
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

export const SCOUT_NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Getting Started", href: "/getting-started" },
  { label: "Documentation", href: "/docs/" },
  { label: "What’s New", href: "/whatsnew" },
  { label: "Support", href: "/support" },
  { label: "Dashboard", href: "/app/" },
] as const;

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

function NavLinks(props: { currentPath?: string | undefined }) {
  return (
    <>
      {SCOUT_NAV_LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="scout-navbar__link"
          aria-current={props.currentPath === link.href ? "page" : undefined}
        >
          {link.label}
        </a>
      ))}
    </>
  );
}

export function GlobalNavbar(props: {
  signedIn?: boolean | undefined;
  currentPath?: string | undefined;
  utility?: ReactNode | undefined;
  accountMenu?: ReactNode | undefined;
  guildAccess?: ReactNode | undefined;
  getStartedTrackingEvent?: string | undefined;
  getStartedLocation?: string | undefined;
}) {
  return (
    <header className="scout-navbar">
      <Container className="scout-navbar__inner">
        <a href="/" aria-label="Scout home">
          <ScoutMark />
        </a>
        <nav className="scout-navbar__links" aria-label="Global">
          <NavLinks currentPath={props.currentPath} />
        </nav>
        <div className="scout-navbar__utility">
          {props.utility}
          {props.guildAccess}
          <ThemeMenu />
          {props.signedIn === true ? (
            props.accountMenu
          ) : (
            <Button asChild size="sm">
              <a
                href="/app/login"
                data-scout-conversion={props.getStartedTrackingEvent}
                data-scout-cta-location={props.getStartedLocation}
              >
                Get Started
              </a>
            </Button>
          )}
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
                  <NavLinks currentPath={props.currentPath} />
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </Container>
    </header>
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
}) {
  return (
    <footer className="scout-footer">
      <Container className="scout-stack">
        <div className="scout-footer__links">
          <a href="/privacy">Privacy</a>
          <a href="/tos">Terms</a>
          <a href="/support">Support</a>
          <a href="https://github.com/shepherdjerred/monorepo/tree/main/packages/scout-for-lol">
            GitHub
          </a>
        </div>
        <p>
          Scout is an independent League of Legends companion created by Jerred
          Shepherd.
        </p>
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
}) {
  return (
    <ResponsivePageFrame
      navbar={
        <GlobalNavbar currentPath={props.currentPath} utility={props.utility} />
      }
      footer={<GlobalFooter release={props.release} commit={props.commit} />}
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
}) {
  return (
    <ResponsivePageFrame
      navbar={
        <GlobalNavbar
          currentPath={props.currentPath}
          signedIn={props.signedIn}
          accountMenu={props.accountMenu}
          guildAccess={props.guildAccess}
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
}) {
  return (
    <GlobalNavbar
      currentPath="/docs/"
      utility={
        <>
          {props.search}
          {props.mobileSidebar}
        </>
      }
    />
  );
}
