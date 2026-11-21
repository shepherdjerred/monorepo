import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["src/read-sync.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
