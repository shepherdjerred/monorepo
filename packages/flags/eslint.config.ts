import { recommended } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    react: true,
  }),
  {
    // Monaco owns this editor's DOM and its text model. The component mirrors
    // controlled props (text loaded from outside, aria attributes) into that
    // external widget after each commit, which is what effects are for.
    files: ["src/client/monaco/json-editor.tsx"],
    rules: { "custom-rules/no-use-effect": "off" },
  },
];
