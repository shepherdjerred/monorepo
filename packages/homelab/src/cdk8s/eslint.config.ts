import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    projectService: { allowDefaultProject: ["eslint.config.ts"] },
  }),
  { rules: { "no-console": "off" } },
  {
    files: ["src/misc/modded-minecraft.ts"],
    rules: { "no-secrets/no-secrets": "off" },
  },
  {
    ignores: ["generated/"],
  },
];
export default config;
