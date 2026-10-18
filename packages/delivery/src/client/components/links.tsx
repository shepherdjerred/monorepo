import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Link as ToolLink } from "@shepherdjerred/ops-model/snapshot.ts";
import type { AppTarget } from "#shared/hub/hub-contract.ts";

/** Plain links to the tools behind a step; the browser decides how to open. */
export function ToolLinks({ links }: { links: ToolLink[] }) {
  if (links.length === 0) return null;
  return (
    <ul className="tool-links">
      {links.map((link) => (
        <li key={link.url}>
          <a href={link.url} className={`tool-link tool-${link.kind}`}>
            {link.label}
            <span aria-hidden="true"> ↗</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function TargetLink({
  target,
  children,
}: {
  target: AppTarget;
  children: ReactNode;
}) {
  switch (target.kind) {
    case "build": {
      return (
        <Link to="/builds/$" params={{ _splat: target.id }}>
          {children}
        </Link>
      );
    }
    case "deployment": {
      return (
        <Link
          to="/deployments/$deploymentId"
          params={{ deploymentId: target.id }}
        >
          {children}
        </Link>
      );
    }
    case "environment": {
      return (
        <Link to="/environments/$" params={{ _splat: target.id }}>
          {children}
        </Link>
      );
    }
    case "versionSet": {
      return (
        <Link to="/versions/$versionSetId" params={{ versionSetId: target.id }}>
          {children}
        </Link>
      );
    }
  }
}

export function ShortSha({ sha }: { sha: string }) {
  return (
    <abbr className="mono" title={sha}>
      {sha.slice(0, 7)}
    </abbr>
  );
}
