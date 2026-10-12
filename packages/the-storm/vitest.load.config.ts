import { paperTestConfig } from "./vitest.e2e.config.ts";

// The rwf bot load test: a manual profile (`bun run test:load`) that boots its
// own server on the production pod's limits. No CI lane runs it.
export default paperTestConfig(["tests/load/**/*.e2e.test.ts"]);
