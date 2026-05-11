import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  { ignores: ["**/example/**", "**/dist/**"] },
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: ["eslint.config.ts", "vitest.config.mts"],
    },
  }),
  {
    files: ["src/index.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
    },
  },
];
export default config;
