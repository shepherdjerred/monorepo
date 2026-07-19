import { recommended } from "@shepherdjerred/eslint-config";

const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: true,
    react: true,
    ignores: ["dist/**", "eslint.config.ts"],
  }),
  {
    rules: {
      "no-console": "off",
    },
  },
];

export default config;
