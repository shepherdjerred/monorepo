import { recommended } from "../eslint-config/local.ts";

export default [
  {
    ignores: ["**/*.astro", "src/env.d.ts", "eslint.config.ts"],
  },
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
];
