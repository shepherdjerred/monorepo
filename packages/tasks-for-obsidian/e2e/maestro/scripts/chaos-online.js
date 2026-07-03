// Maestro GraalJS script: restore the chaos proxy to online (proxying) mode.
// CHAOS_BASE is injected via the runScript `env` block (the proxy's base URL).
var response = http.post(CHAOS_BASE + "/__chaos/online");
if (!response.ok) {
  throw new Error("chaos online toggle failed: HTTP " + response.status);
}
