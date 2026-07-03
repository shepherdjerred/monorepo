// Maestro GraalJS script: restore the chaos proxy to online (proxying) mode.
// CHAOS_BASE is injected via the runScript `env` block (the proxy's base URL).
// http.post wraps okhttp, whose POST requires a non-null body — a bodyless
// call throws "method POST must have a request body".
var response = http.post(CHAOS_BASE + "/__chaos/online", { body: "" });
if (!response.ok) {
  throw new Error("chaos online toggle failed: HTTP " + response.status);
}
