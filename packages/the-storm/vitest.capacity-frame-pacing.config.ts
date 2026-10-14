import { paperTestConfig } from "./vitest.e2e.config.ts";

// Dedicated rendered timing; isolated from server-load and gameplay screenshot observers.
export default paperTestConfig(["tests/capacity/frame-pacing.e2e.test.ts"]);
