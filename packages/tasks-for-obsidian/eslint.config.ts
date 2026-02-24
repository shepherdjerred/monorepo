import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import reactNativePlugin from "eslint-plugin-react-native";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      "react-native": reactNativePlugin,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-native/no-unused-styles": "warn",
      "react-native/no-inline-styles": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": "warn",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    ignores: ["android/", "ios/", "node_modules/", "metro.config.js", "babel.config.js", "react-native.config.js"],
  },
);
