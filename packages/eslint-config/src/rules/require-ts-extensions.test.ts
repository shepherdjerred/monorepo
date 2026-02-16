import { RuleTester } from "@typescript-eslint/rule-tester";
import { requireTsExtensions } from "./require-ts-extensions";

const ruleTester = new RuleTester();

ruleTester.run("require-ts-extensions", requireTsExtensions, {
  valid: [
    { code: 'import { foo } from "./utils.ts";', filename: "src/index.ts" },
    { code: 'import { Component } from "./Component.tsx";', filename: "src/index.tsx" },
    { code: 'import { Client } from "discord.js";', filename: "src/index.ts" },
    { code: 'import { User } from "@scout-for-lol/data";', filename: "src/index.ts" },
    { code: 'import { readFile } from "fs/promises";', filename: "src/index.ts" },
    { code: 'import { z } from "zod";', filename: "src/index.ts" },
    { code: 'import { helper } from "../utils/helper.ts";', filename: "src/components/Button.tsx" },
    { code: 'import { Component } from "../shared/Component.tsx";', filename: "src/components/Button.tsx" },
    { code: 'import config from "./config.json";', filename: "src/index.ts" },
    { code: 'import styles from "./styles.module.css";', filename: "src/index.ts" },
    { code: 'import content from "./file.txt?raw";', filename: "src/index.ts" },
    { code: 'import url from "./image.png?url";', filename: "src/index.ts" },
    { code: 'import data from "./data.svg?inline";', filename: "src/index.ts" },
  ],
  invalid: [
    {
      code: 'import { foo } from "./utils";',
      filename: "src/index.ts",
      errors: [{ messageId: "requireTsExtension", data: { suggestedExtension: ".ts" } }],
      output: 'import { foo } from "./utils.ts";',
    },
    {
      code: 'import { bar } from "../models/user";',
      filename: "src/components/Button.ts",
      errors: [{ messageId: "requireTsExtension", data: { suggestedExtension: ".ts" } }],
      output: 'import { bar } from "../models/user.ts";',
    },
    {
      code: 'import { Component } from "./Component";',
      filename: "src/index.tsx",
      errors: [{ messageId: "requireTsExtension", data: { suggestedExtension: ".tsx" } }],
      output: 'import { Component } from "./Component.tsx";',
    },
    {
      code: 'import { util } from "../../shared/utils";',
      filename: "src/features/auth/login.ts",
      errors: [{ messageId: "requireTsExtension", data: { suggestedExtension: ".ts" } }],
      output: 'import { util } from "../../shared/utils.ts";',
    },
    {
      code: "import { foo } from './config';",
      filename: "src/index.ts",
      errors: [{ messageId: "requireTsExtension", data: { suggestedExtension: ".ts" } }],
      output: "import { foo } from './config.ts';",
    },
    {
      code: 'import { legacy } from "./legacy.js";',
      filename: "src/index.ts",
      errors: [{ messageId: "noJsExtension", data: { suggestedExtension: ".ts" } }],
      output: 'import { legacy } from "./legacy.ts";',
    },
    {
      code: 'import { Component } from "./Component.jsx";',
      filename: "src/index.tsx",
      errors: [{ messageId: "noJsExtension", data: { suggestedExtension: ".tsx" } }],
      output: 'import { Component } from "./Component.tsx";',
    },
    {
      code: 'import { helper } from "../utils/helper.js";',
      filename: "src/components/Button.tsx",
      errors: [{ messageId: "noJsExtension", data: { suggestedExtension: ".tsx" } }],
      output: 'import { helper } from "../utils/helper.tsx";',
    },
  ],
});
