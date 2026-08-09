import assert from "node:assert";
import configuration from "./configuration.ts";

// health check used by Docker (inert under Kubernetes, which uses the probes
// declared on the deployment instead)
try {
  const response = await fetch(
    `http://127.0.0.1:${String(configuration.port)}/live`,
  );
  assert.ok(response.ok);
  console.warn("[Health] Health check passed");
  process.exit(0);
} catch (error) {
  console.error("[Health] Health check failed:", error);
  process.exit(1);
}
