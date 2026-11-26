---
title: Console UI reference
description: The colour tokens, severity vocabulary, contrast pairs, cascade layers and breakpoints shared by the Hub, Delivery, Go link, Flags and Mail consoles and the ops emails.
---

`@shepherdjerred/console-ui` is the shared look of the ops consoles and the
colour source for the ops emails. Its component API lives in the
[package README](https://github.com/shepherdjerred/monorepo/blob/main/packages/console-ui/README.md);
this page lists the contracts other code relies on.

## Colour tokens

[`src/tokens.json`](https://github.com/shepherdjerred/monorepo/blob/main/packages/console-ui/src/tokens.json)
holds every value for the `light` and `dark` themes. `bun run generate` writes
them to `src/styles/tokens.css` as `--ui-<name>` custom properties.

| Token                 | Role                                                       |
| --------------------- | ---------------------------------------------------------- |
| `bg`                  | Page and sidebar surface                                   |
| `panel`               | Inset content panel, buttons, fields, menus                |
| `head`                | Table header rows, group rows, child rows                  |
| `hover`               | Hovered table row and menu item                            |
| `side-hover`          | Hovered sidebar row                                        |
| `active`              | Selected sidebar row                                       |
| `ink`                 | Primary text                                               |
| `ink-2`               | Sidebar row text                                           |
| `muted`               | Secondary text, column headers, icons                      |
| `faint`               | Counts, group labels, placeholders on panel surfaces only  |
| `line`                | Panel, strip and header borders                            |
| `line-soft`           | Table row separators                                       |
| `btn-edge`            | Button and field border, button pressable edge             |
| `track`               | Meter track                                                |
| `accent`              | Selected icon, tab underline, unread dot, focus ring       |
| `on-accent`           | Text on `accent`                                           |
| `sev-<severity>`      | Status glyph and meter fill                                |
| `sev-<severity>-text` | Severity-coloured text: figures, chip values, field errors |
| `sev-<severity>-soft` | Severity tint behind `sev-<severity>-text`, used by emails |

## Theme selection

| Condition                        | Theme |
| -------------------------------- | ----- |
| `html[data-theme="dark"]`        | dark  |
| `html[data-theme="light"]`       | light |
| No `data-theme`, OS prefers dark | dark  |
| No `data-theme`, otherwise       | light |

`createThemeStore(storageKey)` in
[`src/theme.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/console-ui/src/theme.ts)
stores `light` or `dark` under the key, removes it for `system`, and sets or
removes `data-theme`. Hub uses `ops-theme`; Delivery, Go link and Flags use
`delivery-theme`, `golink-theme` and `flags-theme`.

## Severity vocabulary

| Severity  | Default label | Lucide icon    |
| --------- | ------------- | -------------- |
| `ok`      | OK            | `CircleCheck`  |
| `info`    | Info          | `Info`         |
| `unknown` | Unknown       | `CircleHelp`   |
| `warning` | Warning       | `CircleAlert`  |
| `error`   | Error         | `OctagonAlert` |

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

`line`, `line-soft` and `btn-edge` are decorative and carry no contrast
requirement.

## Cascade layers and naming

| Layer           | File                         | Contents                                     |
| --------------- | ---------------------------- | -------------------------------------------- |
| `ui.reset`      | `reset.css`                  | Replacement for Tailwind v4 Preflight        |
| `ui.tokens`     | `tokens.css`, `fonts.css`    | Colour tokens, Inter, font stacks            |
| `ui.components` | `components.css`, `page.css` | `ui-*` shell, component and page-kit classes |

Unlayered app CSS beats all three layers. Every class starts with `ui-`.

## Breakpoints

| Width                | Change                                                                      |
| -------------------- | --------------------------------------------------------------------------- |
| ≤ 1000px             | Figure strip wraps to two columns                                           |
| ≤ 900px              | Sidebar hidden; `TopBar` (or the app's own bar) and drawer show             |
| ≤ 900px of `ui-page` | Summary grid wraps to two columns                                           |
| ≤ 760px              | Panel loses its margin, border and radius                                   |
| ≤ 600px              | Page padding tightens; heading stacks; `ui-data` rows become labelled cards |
