import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    customRules: {
      zod: false,
      bun: true,
      codeOrganization: false,
      typeSafety: false,
      promiseStyle: false,
    },
  }),
  {
    rules: {
      "no-console": "off",
      "unicorn/no-array-sort": "off",
      "regexp/no-unused-capturing-group": "warn",
      "max-depth": ["error", { max: 6 }],
    },
  },
];
