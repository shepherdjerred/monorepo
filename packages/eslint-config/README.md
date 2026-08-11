# @shepherdjerred/eslint-config

Shared ESLint flat config for every TypeScript package in this monorepo:
type-checked typescript-eslint presets, import hygiene, unicorn/regexp/security
plugins, Prettier compatibility, and a plugin of repo-specific custom rules
(most notably `custom-rules/no-type-assertions`, which enforces the repo-wide
ban on `as` casts other than `as const` / `as unknown`).

## Usage

Add the workspace dependency and create an `eslint.config.ts`:

```ts
import { recommended, type TSESLint } from "@shepherdjerred/eslint-config";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  { rules: { "no-console": "off" } },
];

export default config;
```

`recommended(options)` composes base + imports + naming + custom rules +
Prettier, and optionally React/React Native/accessibility layers:

| Option            | Default               | Effect                                                                                                                   |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `tsconfigRootDir` | `process.cwd()`       | Root for typed linting                                                                                                   |
| `projectService`  | `true`                | typescript-eslint project service setting                                                                                |
| `tsconfigPaths`   | `["./tsconfig.json"]` | Paths for the import resolver                                                                                            |
| `useBunResolver`  | `true`                | Bun-aware import resolution (disabled for RN)                                                                            |
| `react`           | `false`               | React + React Hooks rules                                                                                                |
| `reactNative`     | `false`               | React Native rules (implies `react`)                                                                                     |
| `accessibility`   | `false`               | jsx-a11y rules                                                                                                           |
| `customRules`     | see source            | Toggles for optional custom rules (no-use-effect, no-dto-naming, structured logging, shadcn tokens, knip/jscpd analysis) |

## Composable configs

For finer control, the individual flat-config builders are exported from the
package entry and importable directly from `./configs/*`:

- `baseConfig` — type-checked TS, unicorn, regexp, comments, no-secrets
- `importsConfig` — eslint-plugin-import with the TS/Bun resolver
- `reactConfig` / `reactNativeConfig` — React, Hooks, RN rules
- `accessibilityConfig` — jsx-a11y
- `astroConfig` — eslint-plugin-astro (not part of `recommended`; spread it in
  for Astro packages)
- `namingConfig` — naming conventions

## Custom rules

The `customRulesPlugin` (rules namespaced `custom-rules/*`) lives in
`src/rules/`. Highlights:

- `no-type-assertions` — bans all `as` casts except `as const` / `as unknown`
- `prefer-zod-validation`, `no-redundant-zod-parse`, `zod-schema-naming`
- `prefer-bun-apis`, `require-ts-extensions`, `no-parent-imports`,
  `no-re-exports`, `no-type-guards`, `no-function-overloads`,
  `prefer-async-await`, `prefer-date-fns`
- `prisma-client-disconnect`, `satori-best-practices`,
  `require-container-resources`, `prefer-structured-logging`,
  `no-use-effect`, `no-dto-naming`, `no-shadcn-theme-tokens`
- `knip-unused`, `jscpd-duplication` — project-wide analysis rules (opt-in via
  `customRules.analysisRules`)

Individual rules are also exported for advanced composition, and
`@shepherdjerred/eslint-config/rules` exposes the plugin subpath.

## Development

```bash
bun run test        # rule tests (@typescript-eslint/rule-tester)
bun run typecheck
bun run lint
bun run build       # emit dist/ (used by the non-Bun export conditions)
```

Exports resolve to TypeScript sources under Bun and to built `dist/` output
elsewhere (`bun` / `import` / `types` conditions in `package.json`).
