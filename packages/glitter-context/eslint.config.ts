import { recommended } from "@shepherdjerred/eslint-config";

const config = [...recommended({ tsconfigRootDir: import.meta.dirname })];
export default config;
