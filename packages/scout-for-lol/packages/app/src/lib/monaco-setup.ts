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
