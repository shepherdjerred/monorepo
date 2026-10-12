import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  // The shared config ignores **/build/** (build output); src/build is the
  // build-pipeline source and must be linted.
  { ignores: ["!src/build/", "!src/build/**"] },
];
