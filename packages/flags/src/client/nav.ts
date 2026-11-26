import {
  BoxIcon,
  FlaskConicalIcon,
  GitCompareArrowsIcon,
  LayoutGridIcon,
  RadarIcon,
  RocketIcon,
  type LucideIcon,
} from "lucide-react";

export type View = "home" | "compare" | "drift";

export const VIEWS: readonly {
  readonly view: View;
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
}[] = [
  { view: "home", label: "Overview", href: "/", icon: LayoutGridIcon },
  {
    view: "compare",
    label: "Compare",
    href: "/compare",
    icon: GitCompareArrowsIcon,
  },
  { view: "drift", label: "Drift", href: "/drift", icon: RadarIcon },
];

/** The view a pathname shows, or undefined inside a deployment. */
export function viewOf(pathname: string): View | undefined {
  return VIEWS.find((entry) => entry.href === pathname)?.view;
}

/** The browser tab title for a view. */
export function viewTitle(view: View): string {
  switch (view) {
    case "home": {
      return "Flags";
    }
    case "compare": {
      return "Compare · Flags";
    }
    case "drift": {
      return "Drift · Flags";
    }
  }
}

const STAGE_ICONS: ReadonlyMap<string, LucideIcon> = new Map([
  ["prod", RocketIcon],
  ["beta", FlaskConicalIcon],
]);

/** Prod ships, beta is the experiment; other stages (e.g. a server) are boxes. */
export function deploymentIcon(stage: string): LucideIcon {
  return STAGE_ICONS.get(stage) ?? BoxIcon;
}
