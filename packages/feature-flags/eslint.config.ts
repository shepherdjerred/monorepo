import { recommended, type TSESLint } from "@shepherdjerred/eslint-config";

const config: TSESLint.FlatConfig.ConfigArray = [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    // The key list is generated from the managed inventory and grows with every
    // flag; its length is the inventory's, not a hand-written module's.
    files: ["src/managed-flag-keys.generated.ts"],
    rules: { "max-lines": "off" },
  },
];

export default config;
