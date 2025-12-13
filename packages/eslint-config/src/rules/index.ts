import { zodSchemaNaming } from "./zod-schema-naming";
import { noRedundantZodParse } from "./no-redundant-zod-parse";
import { satoriBestPractices } from "./satori-best-practices";
import { prismaClientDisconnect } from "./prisma-client-disconnect";
import { noTypeAssertions } from "./no-type-assertions";
import { preferZodValidation } from "./prefer-zod-validation";
import { preferBunApis } from "./prefer-bun-apis";
import { noReExports } from "./no-re-exports";
import { noUseEffect } from "./no-use-effect";
import { preferDateFns } from "./prefer-date-fns";
import { noFunctionOverloads } from "./no-function-overloads";
import { noParentImports } from "./no-parent-imports";
import { noTypeGuards } from "./no-type-guards";

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
};
