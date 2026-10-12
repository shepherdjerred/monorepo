import { paperTestConfig } from "./vitest.e2e.config.ts";

// A rendered client and ordinary gameplay; run locally, separately from the load matrix.
export default paperTestConfig(["tests/capacity/native.e2e.test.ts"]);
