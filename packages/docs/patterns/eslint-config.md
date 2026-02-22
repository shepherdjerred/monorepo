# ESLint Configuration

Shared flat config at `packages/eslint-config/` exporting a `recommended()` function.

## Usage

All packages import from the shared config. Every package passes `bunx eslint . --max-warnings=0` with zero rule overrides.

## Acceptable Config Overrides

Only these overrides are acceptable:

| Override | Packages | Reason |
|----------|----------|--------|
| `no-console` | CLIs, bots | CLI tools need console output |
| `max-params` | Dagger `index.ts` | Dagger decorator pattern |
| `no-re-exports` | Library entry points | Re-exports are the API surface |
| `no-unsafe-*` | `clauderon/web/frontend` | TypeShare generated types |

## CJS/ESM Interop

CJS packages need `import X from` (not `import * as X`) for ESM interop with the shared config.

## Known Constraints

- `unicorn/prefer-string-replace-all` must be OFF for ES2020 targets
- `clauderon/mobile` is deferred (needs react-native plugin)
- Quality baseline suppression count includes cdk8s generated files (~6700 of 6893 total)
