/**
 * ESLint rule: no-code-duplication
 *
 * Reports code duplication detected by jscpd as ESLint warnings.
 * This enables IDE integration (Problems panel, inline squiggles, etc.)
 *
 * The rule runs jscpd once per lint session and caches results for efficiency.
 */

import { ESLintUtils } from "@typescript-eslint/utils";
import { getOrComputeJscpd } from "./shared/tool-cache";
import { runJscpd } from "./shared/tool-runner";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/shepherdjerred/homelab/blob/main/eslint-rules/${name}.ts`,
);

type MessageIds = "codeDuplication";

type Options = [
  {
    minLines?: number;
  },
];

/**
 * ESLint rule to report jscpd duplication findings
 */
export const noCodeDuplication = createRule<Options, MessageIds>({
  name: "no-code-duplication",
  meta: {
    type: "suggestion",
    docs: {
      description: "Report code duplication detected by jscpd",
    },
    messages: {
      codeDuplication:
        "Duplicated code block ({{lines}} lines) - also found in {{otherFile}}:{{otherStart}}-{{otherEnd}}",
    },
    schema: [
      {
        type: "object",
        properties: {
          minLines: {
            type: "number",
            default: 5,
            description: "Minimum lines for a duplication to be reported",
          },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [
    {
      minLines: 5,
    },
  ],
  create(context, [options]) {
    const filename = context.filename;
    const projectRoot = context.cwd;
    const minLines = options.minLines ?? 5;

    // Get or compute jscpd results (cached per project)
    const jscpdResults = getOrComputeJscpd(projectRoot, () => runJscpd(projectRoot));

    // Check if this file has any duplications
    const fileDuplications = jscpdResults.get(filename);
    if (!fileDuplications || fileDuplications.length === 0) {
      return {};
    }

    // Track reported locations to avoid duplicates
    const reportedLocations = new Set<string>();

    return {
      Program(node) {
        for (const dup of fileDuplications) {
          // Skip if below minimum lines threshold
          if (dup.lines < minLines) {
            continue;
          }

          // Create a unique key for this duplication location
          const locationKey = `${dup.startLine}:${dup.startCol}-${dup.endLine}:${dup.endCol}`;
          if (reportedLocations.has(locationKey)) {
            continue;
          }
          reportedLocations.add(locationKey);

          // Report at the start of the duplicated block
          context.report({
            node,
            loc: {
              start: { line: dup.startLine, column: dup.startCol },
              end: { line: dup.endLine, column: dup.endCol },
            },
            messageId: "codeDuplication",
            data: {
              lines: String(dup.lines),
              otherFile: dup.otherFile,
              otherStart: String(dup.otherStartLine),
              otherEnd: String(dup.otherEndLine),
            },
          });
        }
      },
    };
  },
});
