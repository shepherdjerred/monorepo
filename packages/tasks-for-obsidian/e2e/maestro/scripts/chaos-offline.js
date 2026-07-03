// Maestro GraalJS script: flip the chaos proxy into offline mode.
// CHAOS_BASE is injected via the runScript `env` block (the proxy's base URL).
var response = http.post(CHAOS_BASE + "/__chaos/offline");
if (!response.ok) {
  throw new Error("chaos offline toggle failed: HTTP " + response.status);
}
