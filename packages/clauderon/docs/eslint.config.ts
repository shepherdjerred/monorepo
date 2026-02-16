import { recommended, astroConfig } from "../../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
  }),
  ...astroConfig(),
];
