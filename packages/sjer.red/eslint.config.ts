import { recommended } from "../eslint-config/local.ts";

export default [
  { ignores: ["**/*.astro"] },
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["astro.config.*"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "Bun",
          message: "Bun globals are not available in Astro config files (Vite SSR evaluator). Use Node.js APIs instead (e.g. readFileSync from 'node:fs').",
        },
      ],
      "no-restricted-imports": "off",
    },
  },
];
