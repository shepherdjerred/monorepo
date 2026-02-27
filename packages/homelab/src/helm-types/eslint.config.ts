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
}, {
  files: ["src/type-converter.ts", "src/type-inference.ts", "src/yaml-comments.ts"],
  rules: {
    "max-lines": ["error", { max: 600 }],
  },
});
