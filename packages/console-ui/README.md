# `@shepherdjerred/console-ui`

The shared look of the ops consoles — Hub (`alert-dashboard`), Go link
(`golink`), Flags (`flags`) and Mail (`mail`) — and the colour source for the
ops emails.

It ships a stylesheet, a set of small router-agnostic React components and one
JSON file of colour tokens. Apps keep their own data, routing and page logic.

## Consumption

```ts
import "@shepherdjerred/console-ui/styles/index.css";
import {
  createThemeStore,
  HeaderBar,
  ShellFrame,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  ThemeRow,
} from "@shepherdjerred/console-ui";

const theme = createThemeStore("ops-theme");

<ShellFrame
  sidebar={
    <Sidebar footer={<ThemeRow store={theme} />}>
      <SidebarGroup label="Ops">
        <SidebarItem
          href="/"
          label="Home"
          icon={HouseIcon}
          renderLink={({ href, ...props }) => <NavLink to={href} {...props} />}
        />
      </SidebarGroup>
    </Sidebar>
  }
>
  <main>
    <HeaderBar title="Home" />
  </main>
</ShellFrame>;
```

The package exports TypeScript source (`"./*": "./src/*"`), so consumers build
it with their own Vite pipeline. `@shepherdjerred/console-ui/tokens.json`
exports the raw tokens.

## Components

| Export             | Renders                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `ShellFrame`       | Sidebar beside an inset panel. The document scrolls; the panel never does.                              |
| `Sidebar`          | `<aside>` (named by `label`) with a top row, a named `<nav>`, and a footer pinned to the bottom.        |
| `SidebarGroup`     | A muted label and a `<ul>` labelled by it.                                                              |
| `SidebarItem`      | `<li><a>` with icon, label, optional count and `aria-current`. `renderLink` lets a router draw the `a`. |
| `AppSwitcher`      | Workspace button opening a Base UI menu of `{ label, url, group }` links, same tab.                     |
| `IconButton`       | Icon-only button; `label` is required and becomes its accessible name.                                  |
| `HeaderBar`        | 48px bar: `<h1>` title, optional tabs, muted meta, actions.                                             |
| `Tabs`             | Underlined view toggle as a radio group with one tab stop and arrow, Home and End keys.                 |
| `FigureStrip`      | A `<dl>` of headline figures with optional hint and severity colour.                                    |
| `StatusGlyph`      | Severity icon plus its word; `hideLabel` keeps the word for assistive technology.                       |
| `Meter`            | `role="meter"` 64px bar with visible figure; values past `max` fill the bar.                            |
| `Chip`             | Bordered label/value pair for key metrics.                                                              |
| `Button`           | Base UI button, 28px, pressable edge; `variant` is `default` or `primary`.                              |
| `Field`            | Label, control, hint and error wired with `id`, `aria-describedby` and `aria-invalid`.                  |
| `ThemeRow`         | Sidebar row cycling system → light → dark.                                                              |
| `createThemeStore` | Theme preference in `localStorage`, reflected as `html[data-theme]`; React hooks for both values.       |

Tables, section headings and toolbars are plain markup with classes:
`ui-table`, `ui-table-scroll`, `ui-table-group`, `ui-table-child`, `ui-num`,
`ui-lead`, `ui-unread`, `ui-twist`, `ui-section-head`, `ui-section-title`,
`ui-section-foot`, `ui-toolbar`, `ui-count`, `ui-zero`, `ui-mono`,
`ui-muted`, `ui-strong` and `ui-sr-only`. See `src/styles/components.css`.

Severity is one of `ok`, `info`, `unknown`, `warning` or `error`. Set
`data-sev` on an element to expose `--ui-sev` (glyph and fill colour) and
`--ui-sev-ink` (text colour) to its descendants.

## Tokens

`src/tokens.json` holds every colour for both themes: surfaces, ink levels,
lines, accent, button edge, meter track, and per severity a glyph colour
(`sev-<s>`), a text colour (`sev-<s>-text`) and a soft tint (`sev-<s>-soft`).

`src/styles/tokens.css` is generated from it and committed:

```bash
bun run generate
```

Each token becomes `--ui-<name>`. Light values sit on `:root`. Dark values
apply under `:root[data-theme="dark"]` and, when no theme is pinned, under
`prefers-color-scheme: dark`.

`src/contrast.test.ts` enforces WCAG contrast for every pair the components
draw; the pairs and token roles are listed in the
[Console UI reference](https://wiki.sjer.red/reference/console-ui/). Change a
token, then run the tests.

The ops emails inline these hex values, so a token change also changes email
colours.

## Rules for the stylesheet

- Every rule lives in `@layer ui.reset, ui.tokens, ui.components`, declared in
  that order by `index.css`. An app's unlayered CSS always wins.
- Every class starts with `ui-`, and every colour is a `--ui-*` token.
- `reset.css` replaces Tailwind v4 Preflight. Its header lists the Preflight
  rules it drops.
- Inter comes from `@fontsource-variable/inter`. Berkeley Mono is licensed: the
  stack names it so it renders where installed, and its font files are never
  committed to this public repository.

## Development

```bash
bunx turbo run generate build typecheck test lint --filter=@shepherdjerred/console-ui
```

`src/tokens.test.ts` fails when `tokens.css` is stale, a class lacks the
`ui-` prefix, a rule escapes its layer, or a hex colour appears in
`components.css`.
