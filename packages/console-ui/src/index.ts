// The package's public API. Styles are imported separately:
// `import "@shepherdjerred/console-ui/styles/index.css"`. Deprecated page-kit
// exports (PageBody, PageHeading, SummaryGrid, Card, CardToolbar, Tag,
// Segmented, TopBar, ThemeToggle, SeverityBadge) are deleted in K1.
export {
  BREAKPOINTS,
  SEVERITIES,
  SIDEBAR_QUERY,
  cssVariable,
  tokens,
  type Severity,
  type ThemeName,
  type ThemeTokens,
  type TokenName,
} from "@shepherdjerred/console-ui/tokens.ts";
export {
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  createThemeStore,
  nextThemePreference,
  parseThemePreference,
  type ResolvedTheme,
  type ThemeColorMeta,
  type ThemeEnvironment,
  type ThemePreference,
  type ThemeStore,
} from "@shepherdjerred/console-ui/theme.ts";
export {
  ICONS,
  THEME_ICON,
  type IconName,
} from "@shepherdjerred/console-ui/icons.ts";
export {
  AppSwitcher,
  type AppSwitcherEntry,
  type AppSwitcherProps,
} from "@shepherdjerred/console-ui/components/shell/app-switcher.tsx";
export {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "@shepherdjerred/console-ui/components/button.tsx";
export {
  Banner,
  type BannerProps,
} from "@shepherdjerred/console-ui/components/banner.tsx";
export {
  Chip,
  type ChipProps,
} from "@shepherdjerred/console-ui/components/chip.tsx";
export {
  CommandPalette,
  CommandPaletteButton,
  CommandPaletteSearch,
  createCommandPaletteStore,
  isCommandPaletteShortcut,
  type CommandPaletteButtonProps,
  type CommandPaletteItem,
  type CommandPaletteKeyEvent,
  type CommandPaletteKeyTarget,
  type CommandPaletteProps,
  type CommandPaletteSearchProps,
  type CommandPaletteSection,
  type CommandPaletteStore,
} from "@shepherdjerred/console-ui/components/command-palette.tsx";
export {
  ConsoleShell,
  type ConsoleShellProps,
} from "@shepherdjerred/console-ui/components/shell/console-shell.tsx";
export {
  Dialog,
  DialogClose,
  type DialogProps,
} from "@shepherdjerred/console-ui/components/dialog.tsx";
export {
  Field,
  type FieldControlProps,
  type FieldProps,
} from "@shepherdjerred/console-ui/components/field.tsx";
export {
  FigureStrip,
  type Figure,
  type FigureStripProps,
} from "@shepherdjerred/console-ui/components/figure-strip.tsx";
export {
  HeaderBar,
  type HeaderBarProps,
} from "@shepherdjerred/console-ui/components/header-bar.tsx";
export {
  IconButton,
  type IconButtonProps,
} from "@shepherdjerred/console-ui/components/icon-button.tsx";
export type {
  RenderLinkProps,
  /** What a router link must render to look like a sidebar row. */
  RenderLinkProps as SidebarLinkProps,
} from "@shepherdjerred/console-ui/components/link.tsx";
export {
  Meter,
  type MeterProps,
} from "@shepherdjerred/console-ui/components/meter.tsx";
export {
  NavTabs,
  type NavTabItem,
  type NavTabsProps,
} from "@shepherdjerred/console-ui/components/nav-tabs.tsx";
export {
  Section,
  type SectionProps,
} from "@shepherdjerred/console-ui/components/section.tsx";
export {
  State,
  type StateKind,
  type StateProps,
} from "@shepherdjerred/console-ui/components/state.tsx";
export {
  SeverityBadge,
  type SeverityBadgeProps,
} from "@shepherdjerred/console-ui/components/page-kit/severity-badge.tsx";
export {
  ShellFrame,
  type ShellFrameProps,
} from "@shepherdjerred/console-ui/components/shell/shell-frame.tsx";
export {
  Sidebar,
  SidebarGroup,
  type SidebarGroupProps,
  type SidebarProps,
} from "@shepherdjerred/console-ui/components/shell/sidebar.tsx";
export {
  SidebarItem,
  type SidebarItemProps,
} from "@shepherdjerred/console-ui/components/shell/sidebar-item.tsx";
export {
  Card,
  CardToolbar,
  PageBody,
  PageHeading,
  SummaryGrid,
  Tag,
  type CardProps,
  type PageBodyProps,
  type PageHeadingProps,
  type SummaryGridProps,
  type SummaryItem,
  type TagProps,
} from "@shepherdjerred/console-ui/components/page-kit/page.tsx";
export {
  SearchField,
  type SearchFieldProps,
} from "@shepherdjerred/console-ui/components/search-field.tsx";
export { Segmented } from "@shepherdjerred/console-ui/components/page-kit/segmented.tsx";
export {
  SEVERITY_ICON,
  SEVERITY_LABEL,
  StatusGlyph,
  type StatusGlyphProps,
} from "@shepherdjerred/console-ui/components/status-glyph.tsx";
export {
  Tabs,
  type TabOption,
  type TabsProps,
} from "@shepherdjerred/console-ui/components/tabs.tsx";
export {
  ThemeToggle,
  TopBar,
  type TopBarProps,
} from "@shepherdjerred/console-ui/components/page-kit/top-bar.tsx";
export {
  ThemeRow,
  type ThemeRowProps,
} from "@shepherdjerred/console-ui/components/shell/theme-row.tsx";
