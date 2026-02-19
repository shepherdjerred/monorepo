import { recommended } from "../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
  }),
  {
    rules: {
      "no-console": "off",
    },
  },
];
