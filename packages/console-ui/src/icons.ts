import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SunIcon,
  Trash2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * One lucide icon per meaning, so every console draws "refresh" or "copy"
 * the same way. Severity glyphs live in `SEVERITY_ICON`.
 */
export const ICONS = {
  refresh: RefreshCwIcon,
  copy: CopyIcon,
  copied: CheckIcon,
  close: XIcon,
  menu: MenuIcon,
  search: SearchIcon,
  add: PlusIcon,
  back: ArrowLeftIcon,
  external: ExternalLinkIcon,
  delete: Trash2Icon,
  expand: ChevronRightIcon,
  collapse: ChevronDownIcon,
  sortable: ChevronsUpDownIcon,
  sortAscending: ArrowUpIcon,
  sortDescending: ArrowDownIcon,
  themeLight: SunIcon,
  themeDark: MoonIcon,
  themeSystem: MonitorIcon,
} as const satisfies Readonly<Record<string, LucideIcon>>;

export type IconName = keyof typeof ICONS;

/** The icon for each theme preference. */
export const THEME_ICON = {
  system: ICONS.themeSystem,
  light: ICONS.themeLight,
  dark: ICONS.themeDark,
} as const;
