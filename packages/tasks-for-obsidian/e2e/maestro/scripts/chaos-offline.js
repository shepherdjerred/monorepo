// Maestro GraalJS script: flip the chaos proxy into offline mode.
// CHAOS_BASE is injected via the runScript `env` block (the proxy's base URL).
// http.post wraps okhttp, whose POST requires a non-null body — a bodyless
// call throws "method POST must have a request body".
var response = http.post(CHAOS_BASE + "/__chaos/offline", { body: "" });
if (!response.ok) {
  throw new Error("chaos offline toggle failed: HTTP " + response.status);
}
