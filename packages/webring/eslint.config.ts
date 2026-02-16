import { recommended } from "../eslint-config/local.ts";

export default [
  { ignores: ["**/example/**", "**/dist/**"] },
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
];
