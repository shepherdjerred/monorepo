import type { MouseEvent, ReactNode } from "react";
import { navigate } from "@shepherdjerred/storm-stats/client/router.ts";

export type SpaLinkProps = {
  readonly href: string;
  readonly className?: string | undefined;
  readonly ariaCurrent?: "page" | undefined;
  readonly children: ReactNode;
  readonly onNavigate?: (() => void) | undefined;
};

export function SpaLink({
  href,
  className,
  ariaCurrent,
  children,
  onNavigate,
}: SpaLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(href);
    if (onNavigate !== undefined) {
      onNavigate();
    }
  }

  return (
    <a
      href={href}
      className={className}
      aria-current={ariaCurrent}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
