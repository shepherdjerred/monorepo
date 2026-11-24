import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({ react: true, tsconfigRootDir: import.meta.dirname }),
  {
    // The package entrypoint gathers the public API.
    files: ["src/index.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
    },
  },
];
export default config;
