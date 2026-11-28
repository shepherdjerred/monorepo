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
  ButtonLink,
  type ButtonLinkProps,
} from "@shepherdjerred/console-ui/components/button-link.tsx";
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

// CU2: detail pages, forms, time and formatting, feedback.
export {
  DescriptionList,
  type DescriptionItem,
  type DescriptionListProps,
} from "@shepherdjerred/console-ui/components/detail/description-list.tsx";
export {
  Disclosure,
  type DisclosureProps,
} from "@shepherdjerred/console-ui/components/detail/disclosure.tsx";
export {
  CodeBlock,
  type CodeBlockProps,
} from "@shepherdjerred/console-ui/components/detail/code-block.tsx";
export {
  COPY_RESET_MS,
  CopyButton,
  type CopyButtonProps,
} from "@shepherdjerred/console-ui/components/detail/copy-button.tsx";
export {
  ListToggle,
  Pager,
  cappedCount,
  useCapped,
  type Capped,
  type ListToggleProps,
  type PagerProps,
} from "@shepherdjerred/console-ui/components/detail/pager.tsx";
export {
  BackLink,
  type BackLinkProps,
} from "@shepherdjerred/console-ui/components/detail/back-link.tsx";
export {
  Checkbox,
  type CheckboxProps,
} from "@shepherdjerred/console-ui/components/forms/checkbox.tsx";
export {
  RadioGroup,
  type RadioGroupProps,
  type RadioOption,
} from "@shepherdjerred/console-ui/components/forms/radio-group.tsx";
export {
  Switch,
  type SwitchProps,
} from "@shepherdjerred/console-ui/components/forms/switch.tsx";
export {
  Fieldset,
  type FieldsetProps,
} from "@shepherdjerred/console-ui/components/forms/fieldset.tsx";
export {
  Textarea,
  type TextareaProps,
} from "@shepherdjerred/console-ui/components/forms/textarea.tsx";
export {
  InputAddon,
  type InputAddonProps,
} from "@shepherdjerred/console-ui/components/forms/input-addon.tsx";
export {
  FormActions,
  type FormActionsProps,
} from "@shepherdjerred/console-ui/components/forms/form-actions.tsx";
export {
  ErrorSummary,
  type ErrorSummaryItem,
  type ErrorSummaryProps,
} from "@shepherdjerred/console-ui/components/forms/error-summary.tsx";
export {
  collectErrorSummary,
  fieldErrorMessage,
  type FieldMetaLike,
} from "@shepherdjerred/console-ui/components/forms/bind-field.ts";
export {
  RelativeTime,
  type RelativeTimeProps,
} from "@shepherdjerred/console-ui/components/time/relative-time.tsx";
export {
  ExactTime,
  type ExactTimeProps,
} from "@shepherdjerred/console-ui/components/time/exact-time.tsx";
export {
  Duration,
  type DurationProps,
} from "@shepherdjerred/console-ui/components/time/duration.tsx";
export {
  DISPLAY_ZONE,
  durationIso,
  formatBytes,
  formatCount,
  formatDuration,
  formatExact,
  formatPercent,
  formatRelative,
  toEpochMs,
  toInstant,
  toIso,
  type ExactOptions,
  type ExactPrecision,
  type TimeInput,
} from "@shepherdjerred/console-ui/format/format.ts";
export {
  NOW_INTERVAL_MS,
  createNowStore,
  useNow,
  type NowStore,
  type NowStoreEnvironment,
} from "@shepherdjerred/console-ui/format/use-now.ts";
export { Kbd } from "@shepherdjerred/console-ui/components/feedback/kbd.tsx";
export {
  isEditableTarget,
  useSearchShortcut,
} from "@shepherdjerred/console-ui/components/feedback/use-search-shortcut.ts";
export {
  StatusDot,
  type ConnectionState,
  type StatusDotProps,
} from "@shepherdjerred/console-ui/components/feedback/status-dot.tsx";
export {
  SavedStatus,
  type SavedStatusProps,
} from "@shepherdjerred/console-ui/components/feedback/saved-status.tsx";
export {
  Skeleton,
  type SkeletonProps,
} from "@shepherdjerred/console-ui/components/feedback/skeleton.tsx";
export {
  EmailPreview,
  type EmailPreviewProps,
} from "@shepherdjerred/console-ui/components/feedback/email-preview.tsx";
export {
  DataTable,
  type DataTableProps,
} from "@shepherdjerred/console-ui/components/data/data-table.tsx";
export { VIRTUALIZE_THRESHOLD } from "@shepherdjerred/console-ui/components/data/data-table-state.ts";
export {
  buildDisplayModel,
  compareSortScalars,
  fallbackExportColumns,
  formatDataTableCsv,
  formatDataTableJson,
  normalizeSortScalar,
  sortDataTableRows,
  type DataTableColumn,
  type DataTableExportColumn,
  type DataTableFilter,
  type DataTableFilterOption,
  type DataTableSortState,
  type DisplayItem,
  type DisplayModel,
  type SortDirection,
} from "@shepherdjerred/console-ui/components/data/data-table-model.ts";
export {
  SEVERITY_RANK,
  bucketBySeverity,
  groupBySeverity,
  parseSeverity,
  severityRank,
  type DataTableGroupBy,
} from "@shepherdjerred/console-ui/components/data/severity-buckets.ts";
export {
  isTypingTarget,
  nextRowKey,
  useRowNavigation,
  type RowNavigationOptions,
} from "@shepherdjerred/console-ui/components/data/row-navigation.ts";
export {
  FilterBar,
  describeCount,
  filtersActive,
  type CountNoun,
  type FilterBarProps,
  type FilterBarSearch,
  type FilterState,
} from "@shepherdjerred/console-ui/components/data/filter-bar.tsx";
export {
  BulkBar,
  type BulkBarProps,
} from "@shepherdjerred/console-ui/components/data/bulk-bar.tsx";
export {
  DEFAULT_TIME_ZONE,
  Timeline,
  dayLabel,
  exactText,
  timeText,
  type TimelineItem,
  type TimelineProps,
} from "@shepherdjerred/console-ui/components/data/timeline.tsx";
export {
  Sparkline,
  computeSparklineGeometry,
  type SparklineGeometry,
  type SparklinePoint,
  type SparklineProps,
} from "@shepherdjerred/console-ui/components/data/sparkline.tsx";
export {
  MATRIX_STATUS_LABEL,
  StatusMatrix,
  type MatrixStatus,
  type StatusMatrixCell,
  type StatusMatrixColumn,
  type StatusMatrixProps,
  type StatusMatrixRow,
} from "@shepherdjerred/console-ui/components/data/status-matrix.tsx";
export {
  StackedMeter,
  normalizeSegments,
  type StackedMeterProps,
  type StackedMeterSegment,
} from "@shepherdjerred/console-ui/components/data/stacked-meter.tsx";
export {
  inferMeterSeverity,
  meterValueText,
} from "@shepherdjerred/console-ui/components/meter.tsx";
// Overlays and inputs (CU4).
export {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuItem,
  MenuLinkItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  Submenu,
  type MenuAlign,
  type MenuCheckboxItemProps,
  type MenuGroupProps,
  type MenuItemProps,
  type MenuLinkItemProps,
  type MenuProps,
  type MenuRadioGroupProps,
  type MenuRadioItemProps,
  type MenuSide,
  type SubmenuProps,
} from "@shepherdjerred/console-ui/components/overlays/menu.tsx";
export {
  ContextMenu,
  isContextMenuKey,
  type ContextMenuProps,
} from "@shepherdjerred/console-ui/components/overlays/context-menu.tsx";
export {
  Popover,
  PopoverClose,
  type PopoverProps,
} from "@shepherdjerred/console-ui/components/overlays/popover.tsx";
export {
  ToastProvider,
  toast,
  type ErrorOptions as ToastErrorOptions,
  type NotifyOptions as ToastNotifyOptions,
  type ToastAction,
  type ToastProviderProps,
  type UndoOptions as ToastUndoOptions,
} from "@shepherdjerred/console-ui/components/overlays/toast.tsx";
export {
  Sheet,
  SheetClose,
  type SheetProps,
  type SheetSide,
} from "@shepherdjerred/console-ui/components/overlays/sheet.tsx";
export {
  ActorChip,
  Avatar,
  initials,
  type ActorChipProps,
  type AvatarProps,
  type AvatarSize,
} from "@shepherdjerred/console-ui/components/people/avatar.tsx";
export {
  Select,
  type SelectProps,
} from "@shepherdjerred/console-ui/components/pickers/select.tsx";
export {
  Combobox,
  type ComboboxMultipleProps,
  type ComboboxProps,
  type ComboboxSingleProps,
} from "@shepherdjerred/console-ui/components/pickers/combobox.tsx";
export {
  flattenOptions,
  matchesOption,
  type PickerGroup,
  type PickerOption,
  type PickerOptions,
} from "@shepherdjerred/console-ui/components/pickers/options.tsx";
export {
  createShortcutRegistry,
  type Shortcut,
  type ShortcutEvent,
  type ShortcutKeyTarget,
  type ShortcutRegistry,
  type ShortcutRegistryOptions,
  type ShortcutSheetGroup,
} from "@shepherdjerred/console-ui/components/keyboard/shortcut-registry.ts";
export {
  ariaKeyshortcuts,
  formatShortcut,
  parseShortcut,
  type ShortcutBinding,
  type ShortcutKeyPress,
} from "@shepherdjerred/console-ui/components/keyboard/shortcut-keys.ts";
export {
  ShortcutSheet,
  type ShortcutSheetProps,
} from "@shepherdjerred/console-ui/components/keyboard/shortcut-sheet.tsx";
export {
  KeyHint,
  type KeyHintProps,
} from "@shepherdjerred/console-ui/components/keyboard/key-hint.tsx";
export {
  CommandPaletteCommands,
  matchesCommand,
  type CommandPaletteCommandsProps,
  type PaletteCommand,
  type PaletteLoader,
  type PaletteSections,
  type PaletteSource,
  type PaletteStep,
} from "@shepherdjerred/console-ui/components/palette/palette-commands.tsx";
export {
  createRecentCommands,
  type RecentCommands,
  type RecentCommandsOptions,
} from "@shepherdjerred/console-ui/components/palette/recent-commands.ts";
