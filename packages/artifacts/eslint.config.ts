import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["prisma.config.ts"],
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
];
