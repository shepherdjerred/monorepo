import {
  CalendarDaysIcon,
  CompassIcon,
  HistoryIcon,
  HouseIcon,
  LibraryBigIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /**
   * Marked as the current page only at its own address. Every other item
   * stays marked on the pages beneath it; Home's address is the start of
   * every address, so it must not be.
   */
  end?: boolean;
};

/**
 * Everyday destinations, in sidebar and tab-bar order. Library holds what
 * used to be separate pages (My requests, Leaving soon, Removed) as its own
 * segments.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  { to: "/", label: "Home", icon: HouseIcon, end: true },
  { to: "/discover", label: "Discover", icon: CompassIcon },
  { to: "/library", label: "Library", icon: LibraryBigIcon },
  { to: "/calendar", label: "Calendar", icon: CalendarDaysIcon },
  { to: "/history", label: "History", icon: HistoryIcon },
];

/**
 * The owner's area; its own pages are listed in `manage/sections.ts`. It is
 * in the sidebar, and on a phone in the account panel: the tab bar holds the
 * five everyday destinations and has no room for a sixth.
 */
export const MANAGE_NAV: NavItem = {
  to: "/manage",
  label: "Manage",
  icon: SlidersHorizontalIcon,
};
