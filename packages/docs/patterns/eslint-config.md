# ESLint Configuration

Shared flat config at `packages/eslint-config/` exporting a `recommended()` function.

## Usage

All packages import from the shared config. Every package passes `bunx eslint . --max-warnings=0` with zero rule overrides.

## React Native

Use `reactNative: true` in `recommended()` for React Native projects:

```ts
import { recommended } from "../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    reactNative: true,
    ignores: ["android/", "ios/"],
    customRules: { reactRules: true },
  }),
  { rules: { "no-console": "off" } },
];
```

`reactNative: true` implies `react: true` and additionally:
- Adds `eslint-plugin-react-native` rules
- Adds RN globals (`__DEV__`, `fetch`, timers, etc.)
- Disables DOM React rules (`no-find-dom-node`, `no-unknown-property`, etc.)
- Disables Bun-specific rules (`prefer-bun-apis`, `require-ts-extensions`, `no-parent-imports`)
- Uses standard TS resolver instead of Bun resolver
- Allows PascalCase filenames alongside kebabCase
- Disables `strict-boolean-expressions` (RN conditional rendering idiom)

Both `clauderon/mobile` and `tasks-for-obsidian` use this config.

## Acceptable Config Overrides

Only these overrides are acceptable:

| Override                    | Packages                 | Reason                            |
| --------------------------- | ------------------------ | --------------------------------- |
| `no-console`                | CLIs, bots, RN apps      | CLI tools / RN need console       |
| `max-params`                | Dagger `index.ts`        | Dagger decorator pattern          |
| `no-re-exports`             | Library entry points     | Re-exports are the API surface    |
| `no-unsafe-*`               | `clauderon/web/frontend` | TypeShare generated types         |
| `import/no-relative-packages` | `clauderon/mobile`     | Not a workspace member            |
| `no-color-literals` / `no-inline-styles` | `tasks-for-obsidian` | TODO: migrate to theme constants |

## CJS/ESM Interop

CJS packages need `import X from` (not `import * as X`) for ESM interop with the shared config.

## Known Constraints

- `unicorn/prefer-string-replace-all` must be OFF for ES2020 targets
- Quality baseline suppression count includes cdk8s generated files (~6700 of 6893 total)
