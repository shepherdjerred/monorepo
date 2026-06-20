// `edcore.main` registers the full set of editor contributions (suggest, hover,
// find, folding, …) but NOT the bundled languages/language services — imported
// for its side effects. The leaner `editor.api` entry alone omits the
// contributions (highlighting still works, but autocomplete/hover/the
// triggerSuggest command go missing). We take the typed `monaco` namespace from
// `editor.api` (same singleton; `edcore.main` ships no type declarations).
import "monaco-editor/esm/vs/editor/edcore.main";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// Bundle Monaco locally. The default @monaco-editor/react loader fetches Monaco
// from a CDN, which the app's CSP (script-src / connect-src 'self') blocks. Only
// the base editor worker is needed — scoutql is a custom language with no TS/JSON
// language services. monaco-editor types `MonacoEnvironment` on `Window`, so we
// reach it through a typed view of globalThis.
const globalEnv: typeof globalThis & {
  MonacoEnvironment?: monaco.Environment;
} = globalThis;

globalEnv.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco });
