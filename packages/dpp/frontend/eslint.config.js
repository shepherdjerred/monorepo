import { recommended } from "@shepherdjerred/eslint-config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    ignores: [
      "**/dist/**/*",
      "**/node_modules/**/*",
      "**/public/**/*",
      "**/*.js",
      "**/*.mjs",
    ],
  }),
  {
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "warn",
    },
  },
];
