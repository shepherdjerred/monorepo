/**
 * Reports code duplication detected by jscpd.
 */

import { ESLintUtils } from "@typescript-eslint/utils";
import { getOrComputeJscpd } from "./shared/tool-cache.js";
import { runJscpd } from "./shared/tool-runner.js";

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/shepherdjerred/share/blob/main/packages/eslint-config/src/rules/${name}.ts`,
);

type MessageIds = "codeDuplication";

type Options = [
  {
    minLines?: number;
  },
];

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

    const jscpdResults = getOrComputeJscpd(projectRoot, () =>
      runJscpd(projectRoot),
    );
    const fileDuplications = jscpdResults.get(filename);
    if (!fileDuplications || fileDuplications.length === 0) {
      return {};
    }

    const reportedLocations = new Set<string>();

    return {
      Program(node) {
        for (const dup of fileDuplications) {
          if (dup.lines < minLines) {
            continue;
          }

          const locationKey = `${dup.startLine}:${dup.startCol}-${dup.endLine}:${dup.endCol}`;
          if (reportedLocations.has(locationKey)) {
            continue;
          }
          reportedLocations.add(locationKey);

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
