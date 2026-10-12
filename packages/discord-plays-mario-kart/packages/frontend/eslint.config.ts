import { recommended } from "@shepherdjerred/eslint-config";
const config = [
  ...recommended({
    tsconfigRootDir: import.meta.dirname,
    react: true,
    accessibility: true,
    projectService: {
      allowDefaultProject: ["eslint.config.ts"],
    },
    ignores: ["vite.config.ts", "dist/**/*", "public/**/*"],
  }),
];
export default config;
