import { paperTestConfig } from "./vitest.e2e.config.ts";

// A restart can rebind ephemeral Docker ports, so this suite owns a separate server.
export default paperTestConfig(["tests/startup/**/*.e2e.test.ts"]);
