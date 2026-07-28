import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  { files: ["scripts/**/*.ts"], rules: { "no-console": "off" } },
];
