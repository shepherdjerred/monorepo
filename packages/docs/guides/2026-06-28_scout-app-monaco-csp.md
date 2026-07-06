# Embedding Monaco (or any worker-using lib) in the Scout Web App under Strict CSP

## Status

Complete (reference)

The scout web app (`packages/scout-for-lol/packages/app`, Vite SPA, served from S3 via Caddy under base `/app/`) has a strict CSP defined in `packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts` (`scoutCsp`, shared prod + beta): `default-src 'self'`, `script-src 'self'`, `connect-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' https://cdn.discordapp.com data: blob:`.

Embedding Monaco there (report query studio, PR #1273):

- The default `@monaco-editor/react` loader fetches Monaco from a **CDN** — blocked by `script-src`/`connect-src 'self'`. Must bundle locally: `loader.config({ monaco })`.
- **Bundle entry (critical):** import `monaco-editor/esm/vs/editor/edcore.main` (for side effects) + take the typed namespace from `monaco-editor/esm/vs/editor/editor.api` (same singleton; `edcore.main` has no `.d.ts` → TS7016 if imported for types). `editor.api` ALONE gives core + tokenization (syntax highlighting) but **none of the editor contributions** — autocomplete/hover/`editor.action.triggerSuggest` are silently missing (provider returns items but no suggest widget; console: `command 'editor.action.triggerSuggest' not found`). `edcore.main` = full contributions WITHOUT bundled languages. Do NOT import bare `monaco-editor` (pulls ALL languages, ~2MB+). Register your own language.
- Worker: `import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"` + `self.MonacoEnvironment = { getWorker: () => new EditorWorker() }`. Vite emits it **same-origin** (`/app/assets/editor.worker-*.js`) — allowed by `default-src 'self'`; we added `worker-src 'self' blob:` defensively. No `unsafe-eval` needed.
- `self.MonacoEnvironment` (monaco augments `Window`, not `globalThis`): to satisfy `unicorn/prefer-global-this` without a cast, assign via `const g: typeof globalThis & { MonacoEnvironment?: monaco.Environment } = globalThis`.
- Lazy-load the editor component (`React.lazy` + default export) so Monaco lands in its own chunk.
- SVG previews render via `<img src="data:image/svg+xml;base64,...">` (allowed by `img-src data:`) — never `dangerouslySetInnerHTML` (user-controlled player aliases → XSS).
