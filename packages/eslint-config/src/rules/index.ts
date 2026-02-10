import { zodSchemaNaming } from "./zod-schema-naming.js";
import { noRedundantZodParse } from "./no-redundant-zod-parse.js";
import { satoriBestPractices } from "./satori-best-practices.js";
import { prismaClientDisconnect } from "./prisma-client-disconnect.js";
import { noTypeAssertions } from "./no-type-assertions.js";
import { preferZodValidation } from "./prefer-zod-validation.js";
import { preferBunApis } from "./prefer-bun-apis.js";
import { noReExports } from "./no-re-exports.js";
import { noUseEffect } from "./no-use-effect.js";
import { preferDateFns } from "./prefer-date-fns.js";
import { noFunctionOverloads } from "./no-function-overloads.js";
import { noParentImports } from "./no-parent-imports.js";
import { noTypeGuards } from "./no-type-guards.js";
import { requireTsExtensions } from "./require-ts-extensions.js";
import { preferAsyncAwait } from "./prefer-async-await.js";

/**
 * Custom ESLint plugin with all rules
 */
export const customRulesPlugin = {
  rules: {
    "zod-schema-naming": zodSchemaNaming,
    "no-redundant-zod-parse": noRedundantZodParse,
    "satori-best-practices": satoriBestPractices,
    "prisma-client-disconnect": prismaClientDisconnect,
    "no-type-assertions": noTypeAssertions,
    "prefer-zod-validation": preferZodValidation,
    "prefer-bun-apis": preferBunApis,
    "no-re-exports": noReExports,
    "no-use-effect": noUseEffect,
    "prefer-date-fns": preferDateFns,
    "no-function-overloads": noFunctionOverloads,
    "no-parent-imports": noParentImports,
    "no-type-guards": noTypeGuards,
    "require-ts-extensions": requireTsExtensions,
    "prefer-async-await": preferAsyncAwait,
  },
};

// Re-export individual rules for advanced use cases
export {
  zodSchemaNaming,
  noRedundantZodParse,
  satoriBestPractices,
  prismaClientDisconnect,
  noTypeAssertions,
  preferZodValidation,
  preferBunApis,
  noReExports,
  noUseEffect,
  preferDateFns,
  noFunctionOverloads,
  noParentImports,
  noTypeGuards,
  requireTsExtensions,
  preferAsyncAwait,
};
