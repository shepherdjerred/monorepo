declare module "@eslint-community/eslint-plugin-eslint-comments" {
  import type { ESLint } from "eslint";
  const plugin: ESLint.Plugin;
  export default plugin;
}

declare module "eslint-plugin-jsx-a11y" {
  import type { ESLint } from "eslint";
  const plugin: ESLint.Plugin;
  export = plugin;
}
