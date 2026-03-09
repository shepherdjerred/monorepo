import { recommended, astroConfig } from "@shepherdjerred/eslint-config";

export default [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
  }),
  ...astroConfig(),
  {
    // astro:content is a virtual module only resolvable outside Astro's build pipeline
    files: ["src/content.config.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
];
