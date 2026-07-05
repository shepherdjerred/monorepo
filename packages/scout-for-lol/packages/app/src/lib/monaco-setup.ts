// `monaco-editor` (the package root → `editor.main`) registers the full set of
// editor contributions (suggest, hover, find, folding, …) and re-exports the
// typed `monaco` namespace via the canonical `"."` package export. The leaner
// `edcore.main` / `editor.api` ESM subpaths were used previously to avoid
// bundling built-in language services, but those paths are no longer resolvable
// under TypeScript 6 `moduleResolution: bundler` (the `"./*": "./*"` wildcard
// export confuses the resolver). Language-service workers (TS/CSS/HTML/JSON) are
// not loaded unless those language IDs are activated on a model.
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// Bundle Monaco locally. The default @monaco-editor/react loader fetches Monaco
// from a CDN, which the app's CSP (script-src / connect-src 'self') blocks. Only
// the base editor worker is needed — scoutql is a custom language with no TS/JSON
// language services. The canonical monaco-editor import above brings in
// `declare global { var MonacoEnvironment: Environment | undefined }`, so we
// can assign through globalThis directly without an intersection-type cast.
globalThis.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco });
