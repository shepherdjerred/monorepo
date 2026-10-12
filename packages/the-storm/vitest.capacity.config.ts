import { paperTestConfig } from "./vitest.e2e.config.ts";

// Extended local acceptance; intentionally outside CI.
export default paperTestConfig(["tests/capacity/rwf-capacity.e2e.test.ts"]);
