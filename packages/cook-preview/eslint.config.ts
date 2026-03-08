import { recommended } from "@shepherdjerred/eslint-config";

export default [
  {
    ignores: ["**/*.astro", "src/env.d.ts", "eslint.config.ts"],
  },
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
];
