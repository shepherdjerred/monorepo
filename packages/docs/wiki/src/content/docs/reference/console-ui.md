---
title: Console UI reference
description: The tokens, severity vocabulary, contrast pairs, components, cascade layers, breakpoints and conformance contract shared by the ops consoles and the ops emails.
---

`@shepherdjerred/console-ui` is the one look of the ops consoles — Hub,
Delivery, Tracker, Errors, Mail, Flags, Feeds, Go link, Charts and CI cache —
and the colour source for the ops emails. Its component API lives in the
[package README](https://github.com/shepherdjerred/monorepo/blob/main/packages/console-ui/README.md);
this page lists the contracts other code relies on. Hub's `/kit` page,
opened from the ⌘K palette, renders every piece in both themes.

## Colour tokens

[`src/tokens.json`](https://github.com/shepherdjerred/monorepo/blob/main/packages/console-ui/src/tokens.json)
holds every colour for the `light` and `dark` themes as six-digit hex, which
the emails inline. `bun run generate` writes them to `src/styles/tokens.css`
as `--ui-<name>` custom properties.

| Token                 | Role                                                          |
| --------------------- | ------------------------------------------------------------- |
| `bg`                  | Page and sidebar surface; the `theme-color` meta              |
| `panel`               | Inset content panel, buttons, fields, menus, dialogs          |
| `head`                | Table header rows, group rows, child rows                     |
| `hover`               | Hovered table row and menu item                               |
| `side-hover`          | Hovered sidebar row                                           |
| `active`              | Selected sidebar row, current table row                       |
| `ink`                 | Primary text                                                  |
| `ink-2`               | Sidebar row text                                              |
| `muted`               | Secondary text, column headers, icons                         |
| `faint`               | Counts, group labels, placeholders on panel surfaces only     |
| `line`                | Panel, strip, header and section hairlines                    |
| `line-soft`           | Table row separators                                          |
| `btn-edge`            | Button and field border, button pressable edge                |
| `track`               | Meter track                                                   |
| `accent`              | Selected icon, tab underline, unread dot, focus ring          |
| `on-accent`           | Text on `accent`                                              |
| `accent-edge`         | Primary button's pressable edge (accent mixed 65% with black) |
| `sev-<severity>`      | Status glyph and meter fill                                   |
| `sev-<severity>-text` | Severity-coloured text: words, figures, chip values           |
| `sev-<severity>-soft` | Email chip tint behind `sev-<severity>-text`                  |

`translucent.<theme>` adds `backdrop` (behind dialogs, the drawer and the
palette), `shadow-menu` and `shadow-overlay`.

## Scale tokens

The same file's `scale` holds everything that is not a colour.

| Group   | Tokens                                                                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Spacing | `space-1` 4px, `space-2` 8px, `space-3` 12px, `space-4` 16px, `space-5` 20px, `space-6` 24px, `space-8` 32px; `gutter` 20px (16px at ≤ 600px)                                  |
| Type    | `text-xs` 11px, `text-sm` 12px, `text-md` 12.5px, `text-base` 13px, `text-lg` 14px, `text-xl` 15px, `text-figure` 21px                                                         |
| Weight  | `weight-regular` 400, `weight-medium` 500, `weight-strong` 600                                                                                                                 |
| Radius  | `radius-xs` 2px (meters), `radius-sm` 5px (chips, menu items), `radius-md` 6px (buttons, fields, rows), `radius-lg` 10px (panel, dialogs, palette), `radius-round` (dots only) |
| Size    | `control` 28px, `hit` 28px (44px on `pointer: coarse`), `nav-row` 30px, `head-row` 30px, `group-row` 32px, `row` 36px, `header` 48px, `topbar` 52px, `sidebar` 228px           |
| Layer   | `z-sticky` 10, `z-backdrop` 20, `z-overlay` 21, `z-popover` 50                                                                                                                 |
| Motion  | `duration-press` 80ms, `duration-panel` 180ms, `ease-out`                                                                                                                      |

Type is Inter 13px for text and Berkeley Mono 12px with tabular figures for
numbers and identifiers. There is no uppercase, no letter-spacing beyond the
body's −0.006em, and nothing larger than the 21px figure.

## Breakpoints

`breakpoints` in `tokens.json`, exported to scripts as `BREAKPOINTS`. Media
queries use range syntax on these two numbers only.

| Width   | Change                                                                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≤ 900px | Sidebar hidden; `ConsoleShell`'s top bar and drawer show; figure strips wrap to two columns; sticky table heads sit below the top bar                                      |
| ≤ 600px | Panel loses its margin, border and radius; gutter narrows to 16px; header bars wrap; `data-stack` tables become label/value lines; the palette fills the top of the screen |

`SIDEBAR_QUERY` (`(width > 900px)`) is the query scripts watch; the drawer
closes when it starts matching.

## Theme selection

| Condition                        | Theme |
| -------------------------------- | ----- |
| `html[data-theme="dark"]`        | dark  |
| `html[data-theme="light"]`       | light |
| No `data-theme`, OS prefers dark | dark  |
| No `data-theme`, otherwise       | light |

`createThemeStore()` in
[`src/theme.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/console-ui/src/theme.ts)
stores `light` or `dark` under the shared `ops-theme` key, removes it for
`system`, sets or removes `data-theme`, and keeps every
`<meta name="theme-color">` equal to the `bg` token on screen. Without a DOM
it keeps the preference in memory. Consoles still on their own key
(`delivery-theme`, `golink-theme`, `flags-theme`, Tracker's `tracker.theme`)
are listed in their conformance allowlists.

## Severity vocabulary

| Severity  | Default label | Lucide icon    |
| --------- | ------------- | -------------- |
| `ok`      | OK            | `CircleCheck`  |
| `info`    | Info          | `Info`         |
| `unknown` | Unknown       | `CircleHelp`   |
| `warning` | Warning       | `CircleAlert`  |
| `error`   | Error         | `OctagonAlert` |

Status is always a glyph plus a word (`StatusGlyph`); a state that is not a
severity borrows one's colour with its own icon, such as Running or Queued.

## Contrast contract

[`src/contrast.test.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/console-ui/src/contrast.test.ts)
fails when any of these pairs drops below its WCAG ratio in either theme.

| Foreground                 | Backgrounds                                                     | Minimum |
| -------------------------- | --------------------------------------------------------------- | ------- |
| `ink`, `ink-2`, `muted`    | `bg`, `panel`, `head`, `hover`, `side-hover`, `active`          | 4.5:1   |
| `faint`, `accent`          | `bg`, `panel`, `head`, `hover`                                  | 4.5:1   |
| `on-accent`                | `accent`                                                        | 4.5:1   |
| `sev-<severity>-text`      | `bg`, `panel`, `head`, `hover`, `sev-<severity>-soft`           | 4.5:1   |
| `sev-<severity>`           | `bg`, `panel`, `head`, `hover`, `track`                         | 3:1     |
| `accent` (as an indicator) | `bg`, `panel`, `head`, `hover`, `side-hover`, `active`, `track` | 3:1     |

`line`, `line-soft`, `btn-edge` and `accent-edge` are decorative and carry no
contrast requirement.

## Page pieces

One shared piece per job:

| Job                   | Piece                                     |
| --------------------- | ----------------------------------------- |
| App frame, phone nav  | `ConsoleShell`                            |
| Page header           | `HeaderBar` (with `lead` for a back link) |
| Route tabs            | `NavTabs`                                 |
| View filter           | `Tabs`                                    |
| Headline figures      | `FigureStrip`                             |
| Table                 | `.ui-table`                               |
| Status                | `StatusGlyph`                             |
| Tag, count            | `Chip`, `.ui-count`                       |
| Search, inputs        | `SearchField`, `Field`                    |
| Banner                | `Banner`                                  |
| Loading, empty, error | `State`                                   |
| Section               | `Section`, `.ui-columns`                  |
| Dialog                | `Dialog`, `ui-dialog*` classes            |
| Buttons               | `Button` (`default`, `primary`, `danger`) |
| Command palette       | `CommandPalette`                          |
| Theme                 | `createThemeStore()`                      |
| Icons                 | `ICONS`                                   |

The page kit (`PageBody`, `PageHeading`, `SummaryGrid`, `Card`,
`CardToolbar`, `Tag`, `Segmented`, `TopBar`, `ThemeToggle`, `SeverityBadge`,
`Button size="page"`, `.ui-data`, `.ui-summary*`, `.ui-eyebrow`) is
deprecated and is deleted once nothing imports it.

## Detail, form, time and feedback pieces

| Piece                                                  | Job                                    | Key props                                                                      |
| ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------ |
| `DescriptionList`                                      | Key-value facts                        | `layout` (`grid`, `rail`), `items` `{ label, value, mono?, wide?, severity? }` |
| `Disclosure`                                           | Collapsible block                      | `title`, `count`, `defaultOpen`                                                |
| `CodeBlock`                                            | Mono, scrolling text                   | `code`, `label`, `lineNumbers`, `activeLine`, `wrap`                           |
| `CopyButton`                                           | Copy to clipboard                      | `text`, `label`, `variant` (`icon`, `text`)                                    |
| `Pager`, `ListToggle`, `useCapped`                     | Keyset paging; cap a list and show all | `newerHref`, `olderHref`, `renderLink`; `useCapped(items, cap)`                |
| `BackLink`                                             | `HeaderBar` `lead`                     | `href`, `label`                                                                |
| `Checkbox`, `RadioGroup`, `Switch`                     | Choice controls (Base UI)              | `label`, `hint`, `invalid`, `options`                                          |
| `Fieldset`, `Textarea`, `InputAddon`                   | Field groups and inputs                | `legend`, `hint`, `error`; `prefix`, `suffix`                                  |
| `FormActions`, `ErrorSummary`                          | Form footer; failed-submit summary     | `submit`, `pending`, `cancel`, `status`; `errors`, `focusOnMount`              |
| `RelativeTime`, `ExactTime`, `Duration`                | Times                                  | `value`, `now`; `precision`, `year`; `ms` or `start`/`end`                     |
| `Kbd`, `useSearchShortcut`, `isEditableTarget`         | Keyboard                               | `ref` of the search input                                                      |
| `StatusDot`, `SavedStatus`, `Skeleton`, `EmailPreview` | Feedback                               | `state`; `saved`; `kind`; `html`, `text`                                       |

### Formatters

| Function                                  | Output                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `formatRelative(value, now)`              | `just now` (under 45s), `45s ago`, `5m ago`, `3h ago`, `4d ago`, `2mo ago`, `1y ago`; `in 5m` for the future |
| `formatExact(value, { precision, year })` | `Nov 26, 14:02 PT` (Pacific, 24-hour); `precision` is `day`, `minute` or `second`                            |
| `formatDuration(ms)`                      | `850ms`, `45s`, `12m 5s`, `2h 14m`, `3d 4h`                                                                  |
| `formatBytes(bytes)`                      | Binary units: `0 B`, `1.5 KiB`, `14.2 MiB`, `118 GiB`, `1 TiB`                                               |
| `formatCount(n)`                          | `1,234,567`                                                                                                  |
| `formatPercent(ratio, digits)`            | `97.1%` from `0.971`                                                                                         |

### Conventions

- Timestamps read relative with the exact time on hover (`title`, and the ISO
  moment in `dateTime`). Absolute times are Pacific time.
- Bytes use binary units.
- Page titles read "Page · App".
- Every relative time on a page shares one 30-second ticker, paused while the
  tab is hidden.
- Forms use TanStack Form with a Zod schema; errors are read with
  `fieldErrorMessage` and listed with `ErrorSummary`.

## Conformance contract

Every console runs `conformanceProblems(import.meta.dirname)` from
`@shepherdjerred/console-ui/testing` in a `conformance.test.ts` beside its
client code, against a `conformance-allowlist.json` of
`{ rule, file, count, reason }` entries. Counts are exact: a rise is a new
violation, a fall must lower the entry, so the list only shrinks.

| Rule                 | Fails on                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `colour-literal`     | Hex, `rgb()`/`hsl()`/`oklch()` and friends, `white`, `black` in CSS values                                                                                                                                    |
| `token-redefinition` | An app declaring a `--ui-*` property                                                                                                                                                                          |
| `font-family`        | A family other than `var(--ui-font-sans)` or `var(--ui-font-mono)`                                                                                                                                            |
| `shared-class-patch` | A rule whose subject is a `.ui-*` class, or an unclassed element reached through one                                                                                                                          |
| `local-copy`         | Classes such as `.topbar`, `.nav-drawer`, `.panel`, `.badge`, `.eyebrow`, `.page-header`, `.segmented`, `.button`, `.skip-link`, `*-dialog*`, `*-banner`, `*-state`, `*-mobile-bar`, `*-kpi-card`, `*-picker` |
| `inline-typography`  | `fontSize`, `fontWeight`, `fontFamily`, `letterSpacing` or `textTransform` in TSX                                                                                                                             |
| `deprecated-import`  | Importing a deprecated console-ui export                                                                                                                                                                      |
| `deprecated-prop`    | `size="page"`                                                                                                                                                                                                 |
| `deprecated-class`   | Page-kit classes in TS or TSX                                                                                                                                                                                 |
| `theme-store-key`    | `createThemeStore()` with a key other than the shared one                                                                                                                                                     |
| `theme-color`        | `index.html` lacking light and dark `theme-color` metas equal to `bg`                                                                                                                                         |

`src/consumers.test.ts` fails when a workspace depends on console-ui without
the scan and without an exemption; `ops-model` is exempt because it reads
only `tokens.json`. `src/vocabulary.test.ts` holds the shared stylesheet
itself to the same vocabulary.

## Cascade layers and naming

| Layer           | File                                                        | Contents                                     |
| --------------- | ----------------------------------------------------------- | -------------------------------------------- |
| `ui.reset`      | `reset.css`                                                 | Replacement for Tailwind v4 Preflight        |
| `ui.tokens`     | `tokens.css`, `fonts.css`                                   | Tokens, Inter, Berkeley Mono, font stacks    |
| `ui.components` | `components/*.css` (one per piece), `page.css` (deprecated) | `ui-*` shell, component and page-kit classes |

Unlayered app CSS beats all three layers, which is why the conformance scan
forbids restyling `.ui-*` classes. Every class starts with `ui-`.

## Fonts

`fonts.css` bundles Inter (Fontsource) and Berkeley Mono. The Berkeley Mono
Regular (400) and Bold (700) WOFF2 files sit in `src/styles/fonts/` and are
declared with relative `url()` references, so each console's Vite build emits
them as hashed `/assets/BerkeleyMono-*.woff2` files. A console serves no
font path of its own.

## Command palette

`createCommandPaletteStore()` creates the open state and binds ⌘K and Ctrl+K
on the document. `CommandPalette` draws the modal dialog and
`CommandPaletteSearch` its combobox and grouped listbox; the app supplies
`sections` of `{ id, label, detail?, icon }` items and an `onSelect` that runs
after the dialog has closed and returned focus. `ConsoleShell` adds the
search button to the sidebar and the top bar when given the store.
