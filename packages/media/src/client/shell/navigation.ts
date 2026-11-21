import {
  CalendarDaysIcon,
  CompassIcon,
  HistoryIcon,
  LibraryBigIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

/**
 * Everyday destinations, in sidebar and tab-bar order. Library holds what
 * used to be separate pages (My requests, Leaving soon, Removed) as its own
 * segments.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  { to: "/discover", label: "Discover", icon: CompassIcon },
  { to: "/library", label: "Library", icon: LibraryBigIcon },
  { to: "/calendar", label: "Calendar", icon: CalendarDaysIcon },
  { to: "/history", label: "History", icon: HistoryIcon },
];

/** The owner's area; its own pages are listed in `manage/sections.ts`. */
export const MANAGE_NAV: NavItem = {
  to: "/manage",
  label: "Manage",
  icon: SlidersHorizontalIcon,
};
