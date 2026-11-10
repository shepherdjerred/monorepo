import { APP_HOSTS, TOOL_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import {
  BugIcon,
  ChartLineIcon,
  GitBranchIcon,
  HammerIcon,
  ListTodoIcon,
  RefreshCwIcon,
  RocketIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";

export type ExternalEntry = {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly url: string;
};

/** First-party apps that live on their own host. */
export const APPS: readonly ExternalEntry[] = [
  { label: "Tracker", icon: ListTodoIcon, url: APP_HOSTS.tracker },
  { label: "Delivery", icon: RocketIcon, url: APP_HOSTS.delivery },
];

export const TOOLS: readonly ExternalEntry[] = [
  { label: "Grafana", icon: ChartLineIcon, url: TOOL_HOSTS.grafana },
  { label: "Argo CD", icon: RefreshCwIcon, url: TOOL_HOSTS.argocd },
  { label: "Temporal", icon: WorkflowIcon, url: TOOL_HOSTS.temporal },
  { label: "Woodpecker", icon: HammerIcon, url: TOOL_HOSTS.woodpecker },
  { label: "Bugsink", icon: BugIcon, url: TOOL_HOSTS.bugsink },
  { label: "GitHub", icon: GitBranchIcon, url: TOOL_HOSTS.github },
];
