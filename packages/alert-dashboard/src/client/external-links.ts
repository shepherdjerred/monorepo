import {
  APP_HOSTS,
  CONSOLE_LINKS,
  type ConsoleLink,
} from "@shepherdjerred/ops-model/tool-links.ts";
import {
  ActivityIcon,
  AlertOctagonIcon,
  BellRingIcon,
  BugIcon,
  ChartLineIcon,
  ClapperboardIcon,
  FlagIcon,
  GitBranchIcon,
  HammerIcon,
  HouseIcon,
  LayoutGridIcon,
  LinkIcon,
  ListTodoIcon,
  MailIcon,
  NotebookPenIcon,
  RefreshCwIcon,
  RocketIcon,
  RssIcon,
  ScanSearchIcon,
  SquareActivityIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";

export type ExternalEntry = {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly url: string;
};

/**
 * Hub's icon for each shared console link, by `ConsoleLink.id`. A link
 * without an icon here fails loudly at load, so a new entry in
 * `CONSOLE_LINKS` cannot appear without one.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  delivery: RocketIcon,
  errors: AlertOctagonIcon,
  flags: FlagIcon,
  feeds: RssIcon,
  golink: LinkIcon,
  tracker: ListTodoIcon,
  media: ClapperboardIcon,
  tasknotes: NotebookPenIcon,
  mail: MailIcon,
  grafana: ChartLineIcon,
  argocd: RefreshCwIcon,
  temporal: WorkflowIcon,
  woodpecker: HammerIcon,
  github: GitBranchIcon,
  bugsink: BugIcon,
  phoenix: ScanSearchIcon,
  posthog: SquareActivityIcon,
  prometheus: ActivityIcon,
  alertmanager: BellRingIcon,
  homeassistant: HouseIcon,
};

function entry(link: ConsoleLink): ExternalEntry {
  const icon = ICONS[link.id];
  if (icon === undefined) {
    throw new Error(`No launcher icon for console link "${link.id}"`);
  }
  return { id: link.id, label: link.label, icon, url: link.url };
}

/** Every other console's link, Hub itself excluded. */
const OTHERS = CONSOLE_LINKS.filter((link) => link.id !== "hub");

/** First-party apps that live on their own host. */
export const APPS: readonly ExternalEntry[] = OTHERS.filter(
  (link) => link.group === "Apps",
).map((link) => entry(link));

/**
 * Outside tools, then the Go link index: it lists every tailnet service, so
 * it is the catch-all for anything not named above.
 */
export const TOOLS: readonly ExternalEntry[] = [
  ...OTHERS.filter((link) => link.group === "Tools").map((link) => entry(link)),
  {
    id: "all-services",
    label: "All services",
    icon: LayoutGridIcon,
    url: APP_HOSTS.golink,
  },
];
