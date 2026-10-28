import { paperTestConfig } from "./vitest.e2e.config.ts";

// Restart acceptance owns a disposable server and must not share its ports with other suites.
export default paperTestConfig(["tests/stargate-restart/**/*.e2e.test.ts"]);
