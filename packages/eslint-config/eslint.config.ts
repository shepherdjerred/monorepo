import { recommended } from "./local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: ["eslint.config.ts"],
    },
    ignores: ["dist/**/*"],
  }),
  // Library entry point uses re-exports and .js extensions by design
  {
    files: ["src/index.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
      "custom-rules/require-ts-extensions": "off",
    },
  },
  // Config files use .js extensions for ESM output compatibility
  {
    files: ["src/configs/*.ts"],
    rules: { "custom-rules/require-ts-extensions": "off" },
  },
];
