import packageJson from "./package.json" with { type: "json" };
import { browserTestConfig } from "./src/testing/browser-config.ts";

export default browserTestConfig(packageJson.name);
