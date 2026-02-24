import { recommended } from "../../eslint-config/local.ts";
export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: ["**/dist/**/*", "**/.cache/**/*", "**/node_modules/**/*"],
  }),
  {
    rules: {
      // tRPC React hooks cross the package boundary via type-only AppRouter import.
      // ESLint's type resolver can't follow the generic chain, but tsc resolves it fine.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    // web/ is not a workspace member; relative parent import is the only way to get AppRouter type
    files: ["src/lib/trpc.ts"],
    rules: {
      "import/no-relative-packages": "off",
      "custom-rules/no-parent-imports": "off",
    },
  },
];
