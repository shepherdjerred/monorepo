import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({ react: true, tsconfigRootDir: import.meta.dirname }),
  {
    // The package entrypoints gather the public API.
    files: ["src/index.ts", "src/testing.tsx"],
    rules: {
      "custom-rules/no-re-exports": "off",
    },
  },
];
export default config;
