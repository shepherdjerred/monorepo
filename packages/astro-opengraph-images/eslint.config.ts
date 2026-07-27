import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  {
    ignores: [
      "examples/**",
      "dist/**",
      "eslint.config.ts",
      "vitest.config.mts",
    ],
  },
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: {
      allowDefaultProject: [
        "generate-readme.ts",
        "generate-readme-core.ts",
        "generate-readme.test.ts",
        "generate-readme-smoke.test.ts",
      ],
    },
    tsconfigPaths: ["./tsconfig.json", "./tsconfig.scripts.json"],
  }),
  {
    files: ["src/index.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
      "unicorn/prefer-export-from": "off",
    },
  },
];
export default config;
