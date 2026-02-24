import { describe, it, expect, beforeEach } from "bun:test";
import {
  setupTestDatabase,
  testPrisma,
  testAgent,
} from "./helpers.ts";
import {
  parseCommand,
  isAllowedCommand,
} from "@shepherdjerred/sentinel/permissions/allowlist.ts";
import { buildPermissionHandler } from "@shepherdjerred/sentinel/permissions/index.ts";
import { resetConfig } from "@shepherdjerred/sentinel/config/index.ts";
import type { AgentDefinition } from "@shepherdjerred/sentinel/types/agent.ts";

// Short approval timeout so tier 3 tests don't block
Bun.env["APPROVAL_TIMEOUT_MS"] = "100";

await setupTestDatabase();
// Reset config cache so APPROVAL_TIMEOUT_MS is picked up
resetConfig();

beforeEach(async () => {
  resetConfig();
  await testPrisma.$executeRawUnsafe("DELETE FROM ApprovalRequest");
});

describe("parseCommand", () => {
  it("should parse simple commands", () => {
    expect(parseCommand("git status")).toEqual(["git", "status"]);
  });

  it("should handle flags", () => {
    expect(parseCommand("kubectl get pods -n default -o json")).toEqual([
      "kubectl",
      "get",
      "pods",
      "-n",
      "default",
      "-o",
      "json",
    ]);
  });

  it("should handle single-quoted arguments", () => {
    expect(parseCommand("git log --format='%H %s'")).toEqual([
      "git",
      "log",
      "--format=%H %s",
    ]);
  });

  it("should handle double-quoted arguments", () => {
    expect(parseCommand('git log --format="%H %s"')).toEqual([
      "git",
      "log",
      "--format=%H %s",
    ]);
  });

  it("should reject semicolons", () => {
    expect(parseCommand("gh run list; rm -rf /")).toBeNull();
  });

  it("should reject double ampersand", () => {
    expect(parseCommand("git status && malicious")).toBeNull();
  });

  it("should reject pipes", () => {
    expect(parseCommand("kubectl get pods | grep")).toBeNull();
  });

  it("should reject dollar signs", () => {
    expect(parseCommand("git log $(whoami)")).toBeNull();
  });

  it("should reject backticks", () => {
    expect(parseCommand("echo `whoami`")).toBeNull();
  });

  it("should reject parentheses", () => {
    expect(parseCommand("(evil command)")).toBeNull();
  });

  it("should reject redirect operators", () => {
    expect(parseCommand("cat file > /etc/passwd")).toBeNull();
  });

  it("should reject newlines", () => {
    expect(parseCommand("git status\nrm -rf /")).toBeNull();
  });

  it("should return empty array for empty string", () => {
    expect(parseCommand("")).toEqual([]);
  });

  it("should reject unterminated quotes", () => {
    expect(parseCommand("git log 'unterminated")).toBeNull();
  });

  it("should reject metacharacters inside double quotes", () => {
    expect(parseCommand('gh pr view "$(rm -rf /)"')).toBeNull();
  });

  it("should reject metacharacters inside single quotes", () => {
    expect(parseCommand("gh pr view '$(rm -rf /)'")).toBeNull();
  });

  it("should reject backslash escapes", () => {
    expect(parseCommand(String.raw`gh pr view foo\nbar`)).toBeNull();
  });
});

describe("isAllowedCommand", () => {
  it("should allow gh run list", () => {
    const result = isAllowedCommand(["gh", "run", "list"]);
    expect(result.allowed).toBe(true);
    expect(result.matchedRule).toBe("List GitHub Actions runs");
  });

  it("should allow gh run list with extra args", () => {
    const result = isAllowedCommand([
      "gh",
      "run",
      "list",
      "--limit",
      "10",
    ]);
    expect(result.allowed).toBe(true);
  });

  it("should allow kubectl get pods", () => {
    const result = isAllowedCommand(["kubectl", "get", "pods"]);
    expect(result.allowed).toBe(true);
  });

  it("should allow git status", () => {
    const result = isAllowedCommand(["git", "status"]);
    expect(result.allowed).toBe(true);
  });

  it("should allow bun run typecheck", () => {
    const result = isAllowedCommand(["bun", "run", "typecheck"]);
    expect(result.allowed).toBe(true);
  });

  it("should allow bunx eslint", () => {
    const result = isAllowedCommand(["bunx", "eslint", "."]);
    expect(result.allowed).toBe(true);
  });

  it("should reject unknown commands", () => {
    const result = isAllowedCommand(["rm", "-rf", "/"]);
    expect(result.allowed).toBe(false);
    expect(result.matchedRule).toBeUndefined();
  });

  it("should reject partial prefix matches", () => {
    const result = isAllowedCommand(["gh"]);
    expect(result.allowed).toBe(false);
  });

  it("should reject gh with non-matching subcommand", () => {
    const result = isAllowedCommand(["gh", "auth", "login"]);
    expect(result.allowed).toBe(false);
  });
});

describe("buildPermissionHandler - Tier 1 (auto-allow)", () => {
  it("should auto-allow Read", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Read", { file_path: "/tmp/test.ts" });
    expect(result.behavior).toBe("allow");
  });

  it("should auto-allow Glob", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Glob", { pattern: "**/*.ts" });
    expect(result.behavior).toBe("allow");
  });

  it("should auto-allow Grep", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Grep", { pattern: "TODO" });
    expect(result.behavior).toBe("allow");
  });

  it("should auto-allow WebSearch", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("WebSearch", { query: "bun test" });
    expect(result.behavior).toBe("allow");
  });

  it("should auto-allow WebFetch", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("WebFetch", {
      url: "https://example.com",
    });
    expect(result.behavior).toBe("allow");
  });
});

describe("buildPermissionHandler - Tier 2 (bash allowlist)", () => {
  it("should allow gh run list", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Bash", { command: "gh run list" });
    expect(result.behavior).toBe("allow");
  });

  it("should allow kubectl get pods", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Bash", {
      command: "kubectl get pods",
    });
    expect(result.behavior).toBe("allow");
  });

  it("should allow git status", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Bash", { command: "git status" });
    expect(result.behavior).toBe("allow");
  });

  it("should reject commands with semicolons", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Bash", {
      command: "gh run list; rm -rf /",
    });
    expect(result.behavior).toBe("deny");
  });

  it("should reject commands with &&", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Bash", {
      command: "git status && malicious",
    });
    expect(result.behavior).toBe("deny");
  });

  it("should reject commands with pipes", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Bash", {
      command: "kubectl get pods | grep",
    });
    expect(result.behavior).toBe("deny");
  });

  it("should reject commands with $()", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Bash", {
      command: "git log $(whoami)",
    });
    expect(result.behavior).toBe("deny");
  });

  it("should reject commands with backticks", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Bash", {
      command: "echo `whoami`",
    });
    expect(result.behavior).toBe("deny");
  });

  it("should reject unknown commands", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Bash", {
      command: "rm -rf /tmp/test",
    });
    expect(result.behavior).toBe("deny");
  });
});

describe("buildPermissionHandler - Tool enforcement", () => {
  it("should deny tools not in agent's allowed list", async () => {
    const restrictedAgent: AgentDefinition = {
      ...testAgent,
      tools: ["Read", "Glob", "Grep"],
    };
    const handler = buildPermissionHandler(restrictedAgent, "session-1");
    const result = await handler("Bash", { command: "git status" });
    expect(result.behavior).toBe("deny");
  });

  it("should allow tools in agent's allowed list", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Read", { file_path: "/tmp/test.ts" });
    expect(result.behavior).toBe("allow");
  });
});

describe("buildPermissionHandler - Tier 3 (approval required)", () => {
  it("should require approval for Edit tool (auto-deny stub)", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Edit", {
      file_path: "/tmp/test.ts",
      old_string: "foo",
      new_string: "bar",
    });
    expect(result.behavior).toBe("deny");
  });

  it("should require approval for Write tool (auto-deny stub)", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Write", {
      file_path: "/tmp/test.ts",
      content: "hello",
    });
    expect(result.behavior).toBe("deny");
  });

  it("should require approval for Task tool (auto-deny stub)", async () => {
    const handler = buildPermissionHandler(testAgent, "session-1");
    const result = await handler("Task", {
      description: "Research something",
    });
    expect(result.behavior).toBe("deny");
  });
});
