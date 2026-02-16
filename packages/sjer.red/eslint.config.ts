import { recommended } from "../eslint-config/local.ts";

export default [
  { ignores: ["**/*.astro"] },
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
];
