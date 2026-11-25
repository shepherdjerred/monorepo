import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({ tsconfigRootDir: import.meta.dirname, react: true }),
  {
    files: ["prisma.config.ts", "vite.config.ts"],
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
];
