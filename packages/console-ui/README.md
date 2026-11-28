# `@shepherdjerred/console-ui`

The one look of the ops consoles — Hub (`alert-dashboard`), Delivery
(`delivery`), Tracker (`tracker`), Errors (`errors`), Mail (`mail`), Flags
(`flags`), Feeds (`feeds`), Go link (`golink`), Charts (`charts/client`) and
CI cache (`ci-cache/client`) — and the colour source for the ops emails.

It ships a stylesheet, small router-agnostic React components, a token file,
and the conformance scan every console runs. Apps keep their own data,
routing and page logic.

## What belongs here

A piece goes into console-ui when **two or more consoles need the job**, or
when it **settles how the design handles a job the mockup never drew**
(detail pages, forms, dialogs, empty and loading states). A widget only one
app needs stays in that app — Tracker's board, Delivery's pipeline graph,
Hub's signal list — but it is built only from shared tokens and shared
pieces. The per-app scan below enforces the second half.

The layout rule: the shell's inset panel is the only card. A page is a
`HeaderBar`, then a `FigureStrip`, then `Section`s divided by hairlines; the
panel's `main` has no padding and every block is full-bleed.

## Consumption

```tsx
import "@shepherdjerred/console-ui/styles/index.css";
import {
  ConsoleShell,
  createThemeStore,
  HeaderBar,
  SidebarGroup,
  SidebarItem,
} from "@shepherdjerred/console-ui";

const theme = createThemeStore(); // the shared `ops-theme` key

<ConsoleShell
  app={{ label: "Hub", mark: "H" }}
  apps={consoles}
  theme={theme}
  palette={{ store: paletteStore, label: "Search and commands" }}
  nav={(close) => (
    <SidebarGroup label="Ops">
      <SidebarItem
        href="/"
        label="Home"
        icon={HouseIcon}
        renderLink={({ href, ...props }) => (
          <NavLink to={href} onClick={close} {...props} />
        )}
      />
    </SidebarGroup>
  )}
>
  <main id="main">
    <HeaderBar title="Home" />
  </main>
</ConsoleShell>;
```

The package exports TypeScript source (`"./*": "./src/*"`), so consumers build
it with their own Vite pipeline. `@shepherdjerred/console-ui/tokens.json`
exports the raw tokens and `@shepherdjerred/console-ui/testing` the scan.

## Components

| Export                                   | Renders                                                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ConsoleShell`                           | The whole frame: skip link, sidebar (`AppSwitcher`, palette button, the `nav` you declare once, `sidebarFooter`, `ThemeRow`) beside the panel, and below 900px a top bar whose drawer holds the same `nav`.                          |
| `ShellFrame`                             | Sidebar beside the inset panel; `ConsoleShell` uses it. The document scrolls; the panel never does.                                                                                                                                  |
| `Sidebar`, `SidebarGroup`, `SidebarItem` | `<aside>` with a named `<nav>`; labelled lists of 30px `<li><a>` rows with icon, count and `aria-current`. `renderLink` lets a router draw the `a`.                                                                                  |
| `AppSwitcher`                            | Workspace button opening a Base UI menu of `{ label, url, group }` links, same tab.                                                                                                                                                  |
| `HeaderBar`                              | 48px bar: optional `lead` (back link, breadcrumb), the 15px `<h1>` (`titleId`, `focusOnMount` for focus after navigation), `tabs`, muted `meta`, `actions`. Wraps at phone width.                                                    |
| `Tabs`                                   | Underlined view filter: a radio group with one tab stop and arrow, Home and End keys. Works in a `HeaderBar` and in a `.ui-toolbar`.                                                                                                 |
| `NavTabs`                                | Route tabs with the same look: a named `<nav>` of `{ href, label, count?, current }` links; `renderLink` for routers.                                                                                                                |
| `FigureStrip`                            | A `<dl>` of headline figures split by hairlines; `label`, `layout` (`row` or `wrap`), `Figure.href`, and a glyph on warning, error and unknown figures.                                                                              |
| `Section`                                | A titled block (`title`, `count`, `actions`, `footer`, `headingLevel`, `id`) labelled by its heading. Put two or more in `.ui-columns` to place them side by side.                                                                   |
| `Banner`                                 | A quiet full-bleed row: severity glyph and word, text, `actions`; optional live `role`.                                                                                                                                              |
| `State`                                  | The loading, empty or error line where content would be (`kind`, `children`, `action`); announced as `status` or `alert`.                                                                                                            |
| `Dialog`, `DialogClose`                  | Base UI modal: `title`, `description`, body, `actions`, `size` (`sm`/`md`/`lg`), controlled `open` or a `trigger`. Native `<dialog class="ui-dialog">` with the `ui-dialog-*` parts looks the same.                                  |
| `StatusGlyph`                            | 14px severity glyph plus its word; `label` may be rich content, `icon` swaps the glyph (running, queued), `hideLabel` keeps the word for screen readers only.                                                                        |
| `Chip`                                   | 22px bordered chip: a tag (`children`) or a `label`/`value` metric, optional `severity` and `href`. No margin; group chips in `.ui-chips`.                                                                                           |
| `Button`                                 | Base UI button, 28px with a pressable edge; `variant` is `default`, `primary` or `danger`. Links: `render={<a href="…" />}` with `nativeButton={false}`.                                                                             |
| `IconButton`                             | Icon-only button; `label` is required and becomes its accessible name.                                                                                                                                                               |
| `SearchField`                            | 28px search input on the field look with a leading icon and hidden label; `ref` reaches the input.                                                                                                                                   |
| `Field`                                  | Label, control, hint and error wired with `id`, `aria-describedby` and `aria-invalid`; `stacked` or `inline`.                                                                                                                        |
| `Meter`                                  | `role="meter"` 64px bar with its figure; values past `max` fill the bar.                                                                                                                                                             |
| `ThemeRow`                               | Sidebar row cycling system → light → dark.                                                                                                                                                                                           |
| `CommandPalette` and friends             | `createCommandPaletteStore` (binds ⌘K/Ctrl+K), `CommandPalette` (the modal), `CommandPaletteSearch` (combobox over grouped options), `CommandPaletteButton`, `isCommandPaletteShortcut`. The app supplies `sections` and `onSelect`. |
| `ICONS`, `THEME_ICON`                    | One lucide icon per meaning: refresh, copy, copied, close, menu, search, add, back, external, delete, expand, collapse and the three theme icons. Severity glyphs are `SEVERITY_ICON`.                                               |
| `createThemeStore`                       | Theme preference under the shared `ops-theme` key, reflected as `html[data-theme]`, with `theme-color` metas kept equal to the `bg` token. Works without a DOM (in memory).                                                          |
| `BREAKPOINTS`, `SIDEBAR_QUERY`           | The breakpoint numbers (`phone` 600, `sidebar` 900) and the media query scripts use.                                                                                                                                                 |

Plain markup with classes: `ui-table` (with `ui-table-scroll`,
`ui-table-group`, `ui-table-child`, `ui-table-empty`, `tr[data-current]`,
`th[scope=row]`, `tfoot`, `caption`, `ui-num` for mono right-aligned figures,
`ui-fill` plus `ui-truncate` for a cell that takes the rest of the width,
`ui-row-link` for a whole-row link, `ui-twist` for expand buttons,
`data-sticky` for a sticky head, and `data-stack` for label/value lines on a
phone using each cell's `data-label`), `ui-toolbar` and `ui-toolbar-end`,
`ui-section-body` (padded prose inside a section), `ui-columns`, `ui-chips`,
`ui-count`, `ui-zero`, `ui-mono`, `ui-muted`, `ui-strong`, `ui-truncate`,
`ui-skip-link` and `ui-sr-only`.

Severity is one of `ok`, `info`, `unknown`, `warning` or `error`. Set
`data-sev` on an element to expose `--ui-sev` (glyph and fill colour) and
`--ui-sev-ink` (text colour) to its descendants.

Hub's `/kit` page (open it from ⌘K) shows every piece in a list page and a
detail page, in both themes.

### Deprecated

These copy the old Hub look and are deleted with the page kit (K1), once Go
link and the Flags draft have moved off them. ESLint's `no-deprecated` flags
each use; Go link's are recorded in its `eslint-suppressions.json`.

| Deprecated                                                             | Use instead                                                 |
| ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| `PageBody`                                                             | `<main id="main">` in `ConsoleShell`                        |
| `PageHeading`                                                          | `HeaderBar`                                                 |
| `SummaryGrid`, `.ui-summary*`                                          | `FigureStrip`                                               |
| `Card`, `CardToolbar`                                                  | `Section`, `.ui-toolbar`                                    |
| `Tag`                                                                  | `Chip`                                                      |
| `Segmented`                                                            | `Tabs`                                                      |
| `TopBar`, `ThemeToggle`                                                | `ConsoleShell`                                              |
| `SeverityBadge`                                                        | `StatusGlyph`                                               |
| `Button size="page"`                                                   | `Button` (28px)                                             |
| `.ui-data`, `.ui-eyebrow`, `.ui-input`, `.ui-select`, `.ui-block-head` | `.ui-table`, `HeaderBar`, `Field`, `SearchField`, `Section` |

Their components live in `src/components/page-kit/` and their styles in
`src/styles/page.css`, which also keeps the old banner,
state and 36px search look inside a `PageBody` so Go link renders unchanged.

## Tokens

`src/tokens.json` holds every token; `bun run generate` writes
`src/styles/tokens.css`, where each becomes `--ui-<name>`.

- `light` / `dark`: every colour as six-digit hex (the emails inline them).
- `translucent`: per-theme `backdrop` and the `shadow-menu` and
  `shadow-overlay` shadows.
- `scale`: spacing (`space-1` 4px … `space-8` 32px, `gutter` 20px),
  type (`text-xs` 11 … `text-figure` 21), weights (`weight-regular`,
  `-medium`, `-strong`), radii (`radius-xs` 2, `-sm` 5, `-md` 6, `-lg` 10,
  `-round` for dots only), sizes (`control` 28, `hit`, `nav-row`,
  `head-row`, `group-row`, `row`, `header`, `topbar`, `sidebar`), layers
  (`z-*`) and motion (`duration-*`, `ease-out`).
- `coarse`: overrides on touch screens (`hit` becomes 44px).
- `phone`: overrides at ≤ 600px (`gutter` becomes 16px).
- `breakpoints`: `phone` 600 and `sidebar` 900, also exported as
  `BREAKPOINTS`.

`src/contrast.test.ts` enforces WCAG contrast for every colour pair the
components draw; the pairs are listed in the
[Console UI reference](https://wiki.sjer.red/reference/console-ui/).

## Consistency checks

1. **`src/vocabulary.test.ts`** reads every `src/styles/components/*.css`:
   no `text-transform`, letter-spacing only `0`/`normal`/the body value,
   font sizes, weights, radii and z-indexes only through tokens, the round
   radius only on dots, no `clamp()`, no colour literals, media queries in
   range syntax on the token breakpoints. The deprecated `page.css` has a
   frozen count per rule.
2. **The per-app scan** (`@shepherdjerred/console-ui/testing`). Each console
   has a `conformance.test.ts`:

   ```ts
   test("follows the console-ui vocabulary", async () => {
     expect(await conformanceProblems(import.meta.dirname)).toEqual([]);
   });
   ```

   It scans the directory's CSS, TS and TSX (tests, `e2e`, fixtures and
   generated code skipped) plus the package's `index.html`. Rules: colours
   only through `var(--ui-*)`; no redefined `--ui-*` token; no `font-family`
   outside `--ui-font-*`; no rule restyling a `.ui-*` class (its subject, or
   an unclassed element reached through one, as in `.ui-table tbody th`); no
   local copy of a shared piece (`.topbar`, `.nav-drawer`, `.panel`,
   `.badge`, `.eyebrow`, `.page-header`, `.segmented`, `.button`,
   `.skip-link`, `*-dialog*`, `*-banner`, `*-state`, `*-mobile-bar`,
   `*-kpi-card`, `*-picker`, …); no inline typography in TSX; no deprecated
   imports, `size="page"` or page-kit classes; `createThemeStore()` on the
   shared key; light and dark `theme-color` metas equal to `bg`.

   `conformance-allowlist.json` beside the test lists today's violations as
   `{ rule, file, count, reason }` with **exact** counts. The test fails
   when a count rises (a new violation) or falls (lower the entry), so the
   list only shrinks. Start a new console's list with
   `bun packages/console-ui/scripts/conformance-baseline.ts <dir> "<reason>"`.

3. **`src/consumers.test.ts`**: every workspace that depends on console-ui
   has the scan, or an exemption with a reason (`ops-model` reads only
   `tokens.json`).
4. **`ConsoleShell`**: the frame is one component, so no console can drop
   the switcher, theme row, skip link or phone navigation.

## Rules for the stylesheet

- `index.css` declares `@layer ui.reset, ui.tokens, ui.components` and
  imports one file per piece from `src/styles/components/`, then the
  deprecated `page.css`. An app's unlayered CSS always wins, which is why
  the scan forbids restyling shared classes.
- Every class starts with `ui-`; every colour, size, weight and radius is a
  `--ui-*` token. There is one focus ring (2px accent, 2px offset) and one
  backdrop.
- `reset.css` replaces Tailwind v4 Preflight. Its header lists the
  Preflight rules it drops.
- Inter comes from `@fontsource-variable/inter`. Berkeley Mono's Regular and
  Bold WOFF2 files live in `src/styles/fonts/`; `fonts.css` declares them with
  relative URLs, so every app's Vite build emits them as hashed `/assets/`
  files.

## Development

```bash
bunx turbo run generate build typecheck test lint --filter=@shepherdjerred/console-ui
```

`src/tokens.test.ts` fails when `tokens.css` is stale, a class lacks the
`ui-` prefix, a rule escapes its layer, or a colour literal appears in a
component stylesheet.

## Browser tests

Browser tests run in real Chromium through Vitest browser mode
(`@vitest/browser-playwright`, `vitest-browser-react`) and live in
`src/**/*.browser.test.tsx`. The unit `test` task excludes them.
`src/testing/browser.ts` provides the shared helpers: `expectNoAxeViolations`
(WCAG 2.2 AA tags, the set the Playwright suites use), `setTheme` for light and
dark, `setViewport` with `VIEWPORTS` (375 and 1280), and
`expectNoHorizontalOverflow`. A package opts in with a
`vitest.browser.config.ts` that default-exports
`browserTestConfig(packageJson.name)` from `src/testing/browser-config.ts` and
a `test:browser` script.

```bash
bunx playwright install chromium   # once per machine
bunx turbo run test:browser --filter=@shepherdjerred/console-ui
bun run e2e:affected               # every browser suite a branch affects, as CI selects them
```

The package is a target of the browser lane
(`ci/scripts/selection/playwright-targets.ts`, `task: "test:browser"`). Pull
requests do not run that lane; it runs on main pushes in the `ci-playwright`
image, which holds the matching Chromium, and collects the JUnit report. Run
`bun run e2e:affected` before marking a pull request ready. To add another
package, give it the config and script, add the Playwright and axe dev
dependencies, and list it as a target.
