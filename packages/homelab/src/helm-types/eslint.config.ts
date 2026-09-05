import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: { allowDefaultProject: ["eslint.config.ts"] },
  }),
  { rules: { "no-console": "off" } },
  {
    // This public package emits Node ESM, whose relative specifiers must name
    // the emitted .js files rather than the TypeScript source files.
    files: ["src/**/*.ts"],
    rules: {
      "custom-rules/require-ts-extensions": "off",
    },
  },
  {
    files: ["src/index.ts"],
    rules: {
      "custom-rules/no-re-exports": "off",
    },
  },
  {
    files: ["src/type-converter.ts", "src/yaml-comments.ts"],
    rules: {
      "max-lines": ["error", { max: 600 }],
    },
  },
];
export default config;
