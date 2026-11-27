import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({ tsconfigRootDir: import.meta.dirname, react: true }),
  {
    // Viewers synchronize with imperative systems (iframes, canvases, pdf.js,
    // players, observers), which is what effects are for.
    files: ["src/client/**"],
    rules: { "custom-rules/no-use-effect": "off" },
  },
  {
    files: ["prisma.config.ts", "vite.config.ts", "playwright.config.ts"],
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
];
