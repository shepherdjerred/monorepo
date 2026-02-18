import { recommended } from "../../../eslint-config/local.ts";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    react: true,
    accessibility: true,
    projectService: {
      allowDefaultProject: ["eslint.config.ts"],
    },
    ignores: [
      "vite.config.ts",
      "dist/**/*",
      "public/**/*",
    ],
  }),
  {
    rules: {
      // Legacy project has unresolved types
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Legacy codebase shadows variables
      "@typescript-eslint/no-shadow": "off",
      // ES2020 target - replaceAll not available
      "unicorn/prefer-string-replace-all": "off",
    },
  },
];
