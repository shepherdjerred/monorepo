import type { AppSwitcherEntry } from "@shepherdjerred/console-ui";
import { CONSOLE_LINKS } from "@shepherdjerred/ops-model/tool-links.ts";

/** The workspace button and the console links the shell bar and the floating nav share. */
export const CURRENT_APP = { label: "Artifacts", mark: "A" } as const;

export const SWITCHER_APPS: readonly AppSwitcherEntry[] = [
  { label: "Artifacts", url: "/", group: "Apps" },
  ...CONSOLE_LINKS.filter((link) => link.label !== "Artifacts").map((link) => ({
    label: link.label,
    url: link.url,
    group: link.group,
  })),
];
