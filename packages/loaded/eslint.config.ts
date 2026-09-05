import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({ react: true, tsconfigRootDir: import.meta.dirname }),
];
export default config;
