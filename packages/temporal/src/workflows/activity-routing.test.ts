import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "replay-fixtures") return [];
        return typescriptFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

function proxyRoutingViolations(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "proxyActivities"
    ) {
      const options = node.arguments[0];
      const taskQueue =
        options === undefined || !ts.isObjectLiteralExpression(options)
          ? undefined
          : options.properties.find(
              (property) =>
                ts.isPropertyAssignment(property) &&
                property.name.getText(tree) === "taskQueue",
            );
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      const location = `${path.basename(file)}:${String(line + 1)}`;
      if (taskQueue === undefined) {
        violations.push(`${location} does not name an Activity task queue`);
      } else if (taskQueue.getText(tree).includes("TASK_QUEUES.WORKFLOWS")) {
        violations.push(`${location} routes effects to the Workflow queue`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return violations;
}

describe("central Activity routing", () => {
  it("requires every Activity proxy to name a non-Workflow queue", async () => {
    const workflowRoot = import.meta.dirname;
    const files = await typescriptFiles(workflowRoot);
    const violationGroups = await Promise.all(
      files.map(async (file) => {
        const source = await readFile(file, "utf8");
        return proxyRoutingViolations(file, source);
      }),
    );
    const violations = violationGroups.flat();

    expect(violations).toEqual([]);
  });
});
