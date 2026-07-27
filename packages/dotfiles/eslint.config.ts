import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["bin/*.ts", "scripts/*.ts"],
    rules: {
      "no-console": "off",
      "custom-rules/no-parent-imports": "off",
      "import/no-relative-packages": "off",
    },
  },
  {
    files: ["bin/executable_git_cleanup.ts", "bin/git_cleanup_core.ts"],
    rules: {
      "unicorn/filename-case": ["error", { case: "snakeCase" }],
    },
  },
];
