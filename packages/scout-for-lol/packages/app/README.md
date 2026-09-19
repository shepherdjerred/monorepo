# Scout management app

The Scout SPA, served at `/app/` on scout-for-lol.com. Guild owners manage
players, reports, subscriptions, competitions, Bryan Bucks, and Explore
conversations here. Data comes from `@scout-for-lol/backend` over tRPC; UI comes
from `@scout-for-lol/design-system`.

Run it against a local backend with the Scout dev harness rather than this
package's `dev` script directly:

```bash
bun run --filter='./packages/scout-for-lol' dev:web    # backend :3000, SPA :5180
bun run --filter='./packages/scout-for-lol' dev:login  # prints a signed session URL
```

## Storybook

Components render in isolation in Storybook, with no backend and no Discord
login:

```bash
bun run storybook        # http://localhost:6007
bun run build:storybook  # static catalog in storybook-static/
```

`bun run build` is unrelated — it builds the deployed SPA into `dist/`.

`.storybook/vite.config.ts` is deliberately separate from the SPA's
`vite.config.ts`, which carries three things a catalog must not inherit:
`base: "/app/"`, a dev proxy to a backend no story talks to, and port 5180.

### What wraps a story

`.storybook/preview.tsx` installs the same context `main.tsx` does, outermost
first: `ScoutThemeProvider surface="app"`, then `QueryClientProvider` +
`TRPCProvider` + `LoadingBlockDefaults`, then `MemoryRouter`. Stories never
wrap themselves in any of those.

The Skin and Mode toolbar globals seed the real `scout-theme-v1` preference and
remount the provider, so a story boots the way a page load does. Stories import
`src/styles/global.css`, not the design-system stylesheet on its own — the
`@theme inline` block there is what maps `--scout-*` tokens onto the Tailwind
utilities these components are written in.

### Data

There is no request mocking in this repo, so `src/lib/storybook/trpc-stub.ts`
gives Storybook a tRPC transport that never settles. An unseeded query stays
pending, which renders the component's loading state deterministically instead
of a network error no user would see.

A story that wants real data declares it:

```tsx
export const Leaderboard: Story = {
  parameters: {
    seedQueries: [
      (trpc, queryClient) => {
        queryClient.setQueryData(
          trpc.competition.leaderboard.queryOptions({ competitionId }).queryKey,
          leaderboardFixture,
        );
      },
    ],
  },
};
```

The key must come from `trpc.<path>.queryOptions(<the exact input the component
passes>).queryKey`. A hand-written key, or a different input, produces a
different key: the seed misses silently and the story spins forever.

Two more parameters: `routerEntries` sets the MemoryRouter's initial path, and
`router: "none"` opts out of the router entirely — needed only by
`chrome/route-error-panel`, which builds its own `createMemoryRouter` because
nesting routers throws.

### Adding a story

Story files are **grouped**: one `*.stories.tsx` per component family,
colocated with those components (`src/components/bucks/bucks-cards.stories.tsx`
covers seven card components). Grouping is not cosmetic — `.stories.tsx` counts
against the 25-file-per-directory source budget, and one file per component
would break `bucks`, `competition`, and `explore`.

Use CSF3 with `satisfies` rather than a type assertion, kebab-case filenames,
and explicit `.tsx` extensions on relative imports. Files under
`src/components/**` may import `#src/lib/*` and `#src/hooks/*` but never
`#src/routes/*` — `check-architecture` enforces that in `bun run lint`.

## Tests

```bash
bun run test      # vitest over src
bun run test:e2e  # Playwright over the built catalog
```

`test:e2e` depends on `build:storybook` and serves `storybook-static/` through
`vite preview` on port 5191. It walks every story in the built index and
asserts it mounts, logs no page error, and reports no axe violations. It runs
one theme: the design-system suite already sweeps both skins and both modes
over the primitives these screens are built from, so what is left to check here
is composition and data state, neither of which varies by theme.
