# Scout design system

Shared React components, design tokens, brand assets, and Satori render
helpers behind every Scout surface: the marketing site, the docs site, the
management app, the desktop client, and the report renderer.

Consumers import source through the `exports` map in `package.json`, never a
build output. `bun run build` produces the Storybook catalog, not a library
bundle:

```ts
import { Button } from "@scout-for-lol/design-system/components/button";
import { scoutColors } from "@scout-for-lol/design-system/satori/colors";
import "@scout-for-lol/design-system/styles.css";
```

## Storybook

Storybook is the component catalog.

```bash
bun run dev    # http://localhost:6006
bun run build  # static catalog in storybook-static/
```

The toolbar carries two Scout globals, **Skin** (`modern` / `classic`) and
**Mode** (`light` / `dark` / `system`). They are applied by the decorator in
`.storybook/preview.tsx`, which wraps every story in `ScoutThemeProvider` and
pushes the selection through the same `scout-theme-v1` localStorage
preference and `data-scout-skin` / `data-scout-mode` attributes that ship to
users. The globals seed a story on mount and on change only — a story that
changes the theme from inside, such as `Runtime/ThemeMenu`, keeps that change.
`.storybook/main.ts` injects the pre-paint theme bootstrap script so stories
resolve their theme before first paint, exactly as a real Scout page does.

Champion art, rank crests, fonts, and brand marks are served under
`/assets/scout/**` by `scoutAssetsPlugin` (`src/build/index.ts`), which
Storybook picks up from `vite.config.ts` and which copies those assets into
`storybook-static/` on build.

### Adding a story

Stories are colocated with their component and named in kebab-case
(`src/components/button.stories.tsx`). Use CSF3 with `satisfies` rather than a
type assertion, and give relative imports an explicit extension:

```tsx
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./badge.tsx";

const meta = {
  title: "Components/Badge",
  component: Badge,
  tags: ["autodocs"],
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "Ranked Solo/Duo" } };
```

Do not add `.mdx` files; autodocs covers documentation.

## Tests

```bash
bun run test      # vitest over src (tokens, theme runtime, asset plugin)
bun run test:e2e  # Playwright over the built catalog
```

`test:e2e` depends on `build`, and Playwright serves `storybook-static/`
through `vite preview`. Run
`bunx turbo run build --filter=@scout-for-lol/design-system` first when
invoking Playwright directly, otherwise the spec has no story index to read.

`e2e/catalog.spec.ts` walks every story in `storybook-static/index.json` and
asserts it mounts, logs no page error, loads every image, and reports no axe
violations, in two theme combinations (`modern`/`dark` and `classic`/`light`).
Cost is linear in story count — 434 cases in about four minutes — and the
`themes` array in that spec is the knob if the suite ever needs to shrink.
Page-structure axe rules are disabled there because a story renders a
component, not a document. The image assertion is load-bearing: a broken asset
URL still renders an element with alt text, so nothing else would catch it.

`e2e/theme-runtime.spec.ts` and `e2e/forms.spec.ts` cover behavior that a
render check cannot: cross-tab theme synchronization, system-appearance
tracking with pre-paint attributes, keyboard operation and dialog focus
restoration, and native form validation semantics. They target specific
stories by id, so renaming those stories or their exports breaks the specs —
`Runtime/ThemeMenu` → `Default`, `Components/Overlays/Dialog` → `CreateReport`,
and `Components/Forms/Field` → `SemanticFormStates` are load-bearing names.

Cross-browser visual coverage lives in `@scout-for-lol/design-audit`, which
exercises the shipped Scout surfaces nightly. This package runs chromium only.

## Tokens

`tokens/themes.json` is the source of truth. `bun run generate` writes
`src/generated/tokens.ts` and `styles/generated/tokens.css`; `bun run
check:generated` fails when either drifts. Never edit the generated files.
