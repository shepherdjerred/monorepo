import { recommended } from "../eslint-config/local.ts";

export default [
  { ignores: ["**/*.astro", "src/env.d.ts"] },
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["astro.config.*", "playwright.config.*"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "Bun",
          message:
            "Bun globals are not available in Astro/Playwright config files. Use Node.js APIs instead.",
        },
      ],
      "no-restricted-imports": "off",
      "custom-rules/prefer-bun-apis": "off",
    },
  },
];
