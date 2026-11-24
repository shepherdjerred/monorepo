import { ShellFrame } from "@shepherdjerred/console-ui";
import { useRef } from "react";
import { Outlet } from "react-router";

import { Changes } from "./changes.tsx";
import type { ResolvedNavGroup } from "./platform/module.ts";
import { CommandPalette } from "./platform/palette.tsx";
import { HubSidebar, Topbar } from "./shell-nav.tsx";

/**
 * The app frame around every page: the shared console shell (a quiet
 * sidebar beside an inset panel), or a top bar with a navigation drawer at
 * phone width. Each page renders its own `<main>`, so the content container
 * inside the panel is a plain element. The document scrolls, never the panel.
 */
export function Shell({
  groups,
}: {
  readonly groups: readonly ResolvedNavGroup[];
}): React.JSX.Element {
  const content = useRef<HTMLDivElement>(null);
  return (
    <>
      <a
        className="skip-link"
        href="#content"
        onClick={(event) => {
          // Move focus without adding `#content` to the URL and the history.
          event.preventDefault();
          content.current?.focus();
        }}
      >
        Skip to content
      </a>
      <Changes />
      <CommandPalette />
      <Topbar groups={groups} />
      <ShellFrame sidebar={<HubSidebar groups={groups} />}>
        <div className="app-content" id="content" ref={content} tabIndex={-1}>
          <Outlet />
        </div>
      </ShellFrame>
    </>
  );
}
