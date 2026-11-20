import {
  ArchiveIcon,
  CalendarDaysIcon,
  CompassIcon,
  HistoryIcon,
  HourglassIcon,
  LibraryBigIcon,
  ListChecksIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

/** Everyday destinations, in sidebar order. */
export const PRIMARY_NAV: readonly NavItem[] = [
  { to: "/discover", label: "Discover", icon: CompassIcon },
  { to: "/library", label: "Library", icon: LibraryBigIcon },
  { to: "/requests", label: "My requests", icon: ListChecksIcon },
  { to: "/calendar", label: "Calendar", icon: CalendarDaysIcon },
  { to: "/history", label: "Watch history", icon: HistoryIcon },
];

/** What is about to leave the library and what already has. */
export const HOUSEKEEPING_NAV: readonly NavItem[] = [
  { to: "/removals", label: "Leaving soon", icon: HourglassIcon },
  { to: "/removed", label: "Removed", icon: ArchiveIcon },
];

/** The owner's area; its own pages are listed in `manage/sections.ts`. */
export const MANAGE_NAV: NavItem = {
  to: "/manage",
  label: "Manage",
  icon: SlidersHorizontalIcon,
};

/** A phone's tab bar holds this many primary destinations; More has the rest. */
export const TAB_BAR_COUNT = 4;
