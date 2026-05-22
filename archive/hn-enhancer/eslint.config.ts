import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  {
    ignores: ["vite.config.ts", "eslint.config.ts", "**/*.test.ts"],
  },
  ...recommended({ tsconfigRootDir: import.meta.dirname, react: false }),
  {
    files: ["src/lib/debug.ts"],
    rules: {
      "no-console": "off",
    },
  },
];
export default config;
