import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: ["generated/**", "dist/**"],
  }),
  {
    files: ["prisma.config.ts"],
    // The Prisma CLI loads this file under Node.
    rules: { "custom-rules/prefer-bun-apis": "off" },
  },
];

export default config;
