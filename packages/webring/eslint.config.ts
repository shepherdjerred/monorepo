import { recommended } from "../eslint-config/local.ts";

export default [
  { ignores: ["**/example/**", "**/dist/**"] },
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: ["eslint.config.ts"],
    },
  }),
  {
    files: ["src/index.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
    },
  },
];
