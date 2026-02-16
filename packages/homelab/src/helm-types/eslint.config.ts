import { defineConfig } from "eslint/config";
import rootConfig from "../../eslint.config.ts";

export default defineConfig(...rootConfig, {
  languageOptions: {
    parserOptions: {
      projectService: {
        allowDefaultProject: ["eslint.config.ts"],
      },
      tsconfigRootDir: import.meta.dirname,
    },
  },
});
