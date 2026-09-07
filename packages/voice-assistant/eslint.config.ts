import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    // The package entry is deliberately a barrel over this package's own modules.
    files: ["src/index.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
    },
  },
];
export default config;
