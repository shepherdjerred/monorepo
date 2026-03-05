import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";

const permLogger = logger.child({ module: "permissions:allowlist" });

type AllowlistEntry = {
  command: string[];
  description: string;
};

const SAFE_COMMANDS: AllowlistEntry[] = [
  // GitHub CLI (read-only)
  { command: ["gh", "run", "list"], description: "List GitHub Actions runs" },
  { command: ["gh", "run", "view"], description: "View GitHub Actions run" },
  { command: ["gh", "pr", "view"], description: "View a GitHub PR" },
  { command: ["gh", "pr", "list"], description: "List GitHub PRs" },
  { command: ["gh", "pr", "checks"], description: "View PR check status" },
  { command: ["gh", "issue", "list"], description: "List GitHub issues" },
  { command: ["gh", "issue", "view"], description: "View a GitHub issue" },
  { command: ["gh", "api"], description: "GitHub API call" },
  // Kubernetes (read-only)
  { command: ["kubectl", "get"], description: "Get Kubernetes resources" },
  {
    command: ["kubectl", "describe"],
    description: "Describe Kubernetes resources",
  },
  { command: ["kubectl", "logs"], description: "View pod logs" },
  { command: ["kubectl", "top"], description: "View resource usage" },
  // ArgoCD (read-only)
  {
    command: ["argocd", "app", "list"],
    description: "List ArgoCD applications",
  },
  { command: ["argocd", "app", "get"], description: "Get ArgoCD app details" },
  { command: ["argocd", "app", "diff"], description: "Diff ArgoCD app" },
  // Talos (read-only)
  {
    command: ["talosctl", "health"],
    description: "Check Talos cluster health",
  },
  { command: ["talosctl", "get"], description: "Get Talos resources" },
  { command: ["talosctl", "dashboard"], description: "View Talos dashboard" },
  // Git (read-only)
  { command: ["git", "log"], description: "View git log" },
  { command: ["git", "status"], description: "Check git status" },
  { command: ["git", "diff"], description: "View git diff" },
  { command: ["git", "show"], description: "Show git object" },
  { command: ["git", "branch"], description: "List branches" },
  { command: ["git", "rev-parse"], description: "Parse git refs" },
  // Build tools (safe — these don't modify code)
  { command: ["bun", "run", "typecheck"], description: "Run typecheck" },
  { command: ["bun", "run", "test"], description: "Run tests" },
  { command: ["bun", "run", "lint"], description: "Run linter" },
  { command: ["bun", "run", "build"], description: "Run build" },
  { command: ["bunx", "eslint"], description: "Run ESLint" },
  // System tools (read-only)
  { command: ["ls"], description: "List directory" },
  { command: ["cat"], description: "Read file" },
  { command: ["head"], description: "Read file head" },
  { command: ["tail"], description: "Read file tail" },
  { command: ["wc"], description: "Count lines/words" },
  { command: ["which"], description: "Find command path" },
  { command: ["date"], description: "Show date/time" },
  { command: ["df"], description: "Show disk usage" },
  { command: ["du"], description: "Show directory size" },
  { command: ["ps"], description: "List processes" },
  { command: ["uptime"], description: "Show system uptime" },
  { command: ["curl"], description: "HTTP request" },
];

// Characters that indicate shell metacharacter injection.
// Checked in ALL characters (both inside and outside quotes) to prevent
// injection via command substitution or shell expansion in quoted strings.
const SHELL_METACHARACTERS = /[;|&$`()><\n\\!]/;

/**
 * Parse a command string into argv tokens.
 * Handles single-quoted and double-quoted strings.
 * Returns null if shell metacharacters are found ANYWHERE (including inside quotes),
 * since the original command string is passed to bash which does its own parsing.
 */
export function parseCommand(cmdString: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (const ch of cmdString) {
    // Check for metacharacters in ALL positions (inside and outside quotes).
    // The raw command string is passed to bash, so metacharacters inside quotes
    // can still trigger command substitution, variable expansion, etc.
    if (SHELL_METACHARACTERS.test(ch)) {
      permLogger.warn(
        { command: cmdString, metacharacter: ch },
        "Shell metacharacter detected in command",
      );
      return null;
    }

    if (inSingleQuote) {
      if (ch === "'") {
        inSingleQuote = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (ch === '"') {
        inDoubleQuote = false;
      } else {
        current += ch;
      }
      continue;
    }

    switch (ch) {
      case "'": {
        inSingleQuote = true;

        break;
      }
      case '"': {
        inDoubleQuote = true;

        break;
      }
      case " ":
      case "\t": {
        if (current.length > 0) {
          tokens.push(current);
          current = "";
        }

        break;
      }
      default: {
        current += ch;
      }
    }
  }

  // Unterminated quotes are also suspicious
  if (inSingleQuote || inDoubleQuote) {
    permLogger.warn({ command: cmdString }, "Unterminated quote in command");
    return null;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Check if the given argv matches any safe command prefix in the allowlist.
 */
export function isAllowedCommand(argv: string[]): {
  allowed: boolean;
  matchedRule?: string;
} {
  for (const entry of SAFE_COMMANDS) {
    if (argv.length >= entry.command.length) {
      const matches = entry.command.every(
        (part, index) => argv[index] === part,
      );
      if (matches) {
        return { allowed: true, matchedRule: entry.description };
      }
    }
  }
  return { allowed: false };
}
