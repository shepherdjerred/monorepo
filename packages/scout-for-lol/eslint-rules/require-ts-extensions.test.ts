/**
 * Tests for require-ts-extensions rule
 */

import { RuleTester } from "@typescript-eslint/rule-tester";
import { requireTsExtensions } from "./require-ts-extensions.ts";

const ruleTester = new RuleTester();

ruleTester.run("require-ts-extensions", requireTsExtensions, {
  valid: [
    // Valid: Has .ts extension
    {
      code: 'import { foo } from "./utils.ts";',
      filename: "src/index.ts",
    },
    // Valid: Has .tsx extension
    {
      code: 'import { Component } from "./Component.tsx";',
      filename: "src/index.tsx",
    },
    // Valid: Third-party package without extension
    {
      code: 'import { Client } from "discord.js";',
      filename: "src/index.ts",
    },
    // Valid: Workspace package without extension
    {
      code: 'import { User } from "@scout-for-lol/data";',
      filename: "src/index.ts",
    },
    // Valid: Node built-in
    {
      code: 'import { readFile } from "fs/promises";',
      filename: "src/index.ts",
    },
    // Valid: Scoped package
    {
      code: 'import { z } from "zod";',
      filename: "src/index.ts",
    },
    // Valid: Parent import with .ts extension
    {
      code: 'import { helper } from "../utils/helper.ts";',
      filename: "src/components/Button.tsx",
    },
    // Valid: Parent import with .tsx extension
    {
      code: 'import { Component } from "../shared/Component.tsx";',
      filename: "src/components/Button.tsx",
    },
    // Valid: JSON import (has extension, different from .js/.jsx)
    {
      code: 'import config from "./config.json";',
      filename: "src/index.ts",
    },
    // Valid: CSS module import
    {
      code: 'import styles from "./styles.module.css";',
      filename: "src/index.ts",
    },
    // Valid: Vite ?raw import for text files
    {
      code: 'import content from "./file.txt?raw";',
      filename: "src/index.ts",
    },
    // Valid: Vite ?url import
    {
      code: 'import url from "./image.png?url";',
      filename: "src/index.ts",
    },
    // Valid: Vite ?inline import
    {
      code: 'import data from "./data.svg?inline";',
      filename: "src/index.ts",
    },
  ],

  invalid: [
    // Invalid: Missing .ts extension on same-directory import
    {
      code: 'import { foo } from "./utils";',
      filename: "src/index.ts",
      errors: [
        {
          messageId: "requireTsExtension",
          data: { suggestedExtension: ".ts" },
        },
      ],
      output: 'import { foo } from "./utils.ts";',
    },
    // Invalid: Missing .ts extension on parent import
    {
      code: 'import { bar } from "../models/user";',
      filename: "src/components/Button.ts",
      errors: [
        {
          messageId: "requireTsExtension",
          data: { suggestedExtension: ".ts" },
        },
      ],
      output: 'import { bar } from "../models/user.ts";',
    },
    // Invalid: Missing .tsx extension in tsx file
    // Note: Auto-fix uses heuristic based on importing file's extension
    {
      code: 'import { Component } from "./Component";',
      filename: "src/index.tsx",
      errors: [
        {
          messageId: "requireTsExtension",
          data: { suggestedExtension: ".tsx" },
        },
      ],
      output: 'import { Component } from "./Component.tsx";',
    },
    // Invalid: Deep relative path without extension
    {
      code: 'import { util } from "../../shared/utils";',
      filename: "src/features/auth/login.ts",
      errors: [
        {
          messageId: "requireTsExtension",
          data: { suggestedExtension: ".ts" },
        },
      ],
      output: 'import { util } from "../../shared/utils.ts";',
    },
    // Invalid: Same directory import with single quotes
    {
      code: "import { foo } from './config';",
      filename: "src/index.ts",
      errors: [
        {
          messageId: "requireTsExtension",
          data: { suggestedExtension: ".ts" },
        },
      ],
      output: "import { foo } from './config.ts';",
    },
    // Invalid: Using .js extension instead of .ts
    {
      code: 'import { legacy } from "./legacy.js";',
      filename: "src/index.ts",
      errors: [
        {
          messageId: "noJsExtension",
          data: { suggestedExtension: ".ts" },
        },
      ],
      output: 'import { legacy } from "./legacy.ts";',
    },
    // Invalid: Using .jsx extension instead of .tsx
    {
      code: 'import { Component } from "./Component.jsx";',
      filename: "src/index.tsx",
      errors: [
        {
          messageId: "noJsExtension",
          data: { suggestedExtension: ".tsx" },
        },
      ],
      output: 'import { Component } from "./Component.tsx";',
    },
    // Invalid: Using .js extension in tsx file (should suggest .tsx)
    {
      code: 'import { helper } from "../utils/helper.js";',
      filename: "src/components/Button.tsx",
      errors: [
        {
          messageId: "noJsExtension",
          data: { suggestedExtension: ".tsx" },
        },
      ],
      output: 'import { helper } from "../utils/helper.tsx";',
    },
  ],
});
