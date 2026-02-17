import type { TSESLint } from "@typescript-eslint/utils";

export const requireTsExtensions: TSESLint.RuleModule<
  "requireTsExtension" | "noJsExtension"
> = {
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description: "Require explicit .ts or .tsx extensions for local imports",
    },
    messages: {
      requireTsExtension:
        "Local imports must include explicit .ts or .tsx extensions. Add '{{ suggestedExtension }}' to the import path.",
      noJsExtension:
        "Local imports should use .ts or .tsx extensions, not .js or .jsx. Change to '{{ suggestedExtension }}'.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      ImportDeclaration(node) {
        const importPath = node.source.value;

        // Only check relative imports (starting with ./ or ../)
        const relativeImportRegex = /^\.\.?\//u;
        if (
          typeof importPath !== "string" ||
          !relativeImportRegex.exec(importPath)
        ) {
          return;
        }

        // Strip Vite query strings like ?raw, ?url, ?inline for extension checking
        const pathWithoutQuery = importPath.split("?")[0] ?? importPath;

        // Determine suggested extension based on file type
        const currentFileName = context.filename;
        const suggestedExtension = currentFileName.endsWith(".tsx")
          ? ".tsx"
          : ".ts";

        // Check for .js/.jsx extensions and flag them
        const jsExtensionMatch = /\.jsx?$/u.exec(pathWithoutQuery);
        if (jsExtensionMatch) {
          const oldExtension = jsExtensionMatch[0];
          context.report({
            node: node.source,
            messageId: "noJsExtension",
            data: {
              suggestedExtension,
            },
            fix(fixer) {
              const newExtension =
                oldExtension === ".jsx" ? ".tsx" : suggestedExtension;
              const fixedPath = importPath.replace(
                /\.jsx?(?=\?|$)/u,
                newExtension,
              );
              const sourceText = node.source.raw;
              const quoteChar = sourceText.charAt(0);
              return fixer.replaceText(
                node.source,
                `${quoteChar}${fixedPath}${quoteChar}`,
              );
            },
          });
          return;
        }

        // Check if it has .ts or .tsx extension (valid)
        const hasTsExtension = /\.tsx?$/u.exec(pathWithoutQuery);
        if (hasTsExtension) {
          return;
        }

        // Skip imports that have other extensions (like .json, .css, .txt, etc.)
        const hasOtherExtension = /\.[a-z]+(?:\.[a-z]+)?$/iu.exec(
          pathWithoutQuery,
        );
        if (hasOtherExtension) {
          return;
        }

        // At this point, we have a relative import without any extension
        context.report({
          node: node.source,
          messageId: "requireTsExtension",
          data: {
            suggestedExtension,
          },
          fix(fixer) {
            const actualExtension = suggestedExtension;
            const sourceText = node.source.raw;
            const quoteChar = sourceText.charAt(0);
            const fixedPath = `${importPath}${actualExtension}`;
            return fixer.replaceText(
              node.source,
              `${quoteChar}${fixedPath}${quoteChar}`,
            );
          },
        });
      },
    };
  },
};
