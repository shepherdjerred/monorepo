import { recommended } from "../eslint-config/local.ts";

export default [
  { ignores: ["fetcher/**", "vite.config.ts", "eslint.config.ts"] },
  ...recommended({ tsconfigRootDir: import.meta.dirname, react: true }),
  {
    rules: {
      // ES2020 target does not support String#replaceAll or Array#toSorted
      "unicorn/prefer-string-replace-all": "off",
      "unicorn/no-array-sort": "off",
      // Legacy app uses type guards for discriminated unions and type assertions for localStorage/API data
      "custom-rules/no-type-assertions": "off",
      "custom-rules/no-type-guards": "off",
    },
  },
];
