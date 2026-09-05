import { recommended } from "@shepherdjerred/eslint-config";
const config = [
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
  {
    // This public package emits Node ESM. Source imports deliberately spell
    // their emitted .js filenames, including internal parent paths.
    files: ["src/**/*.ts", "test/**/*.ts"],
    rules: {
      "custom-rules/no-parent-imports": "off",
      "custom-rules/require-ts-extensions": "off",
    },
  },
];
export default config;
