import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";

const permLogger = logger.child({ module: "permissions:allowlist" });

type AllowlistEntry = {
  command: string[];
  description: string;
};

const SAFE_COMMANDS: AllowlistEntry[] = [
  { command: ["gh", "run", "list"], description: "List GitHub Actions runs" },
  { command: ["gh", "pr", "view"], description: "View a GitHub PR" },
  { command: ["gh", "pr", "list"], description: "List GitHub PRs" },
  { command: ["gh", "issue", "list"], description: "List GitHub issues" },
  { command: ["kubectl", "get"], description: "Get Kubernetes resources" },
  {
    command: ["kubectl", "describe"],
    description: "Describe Kubernetes resources",
  },
  { command: ["kubectl", "logs"], description: "View pod logs" },
  {
    command: ["argocd", "app", "list"],
    description: "List ArgoCD applications",
  },
  {
    command: ["argocd", "app", "get"],
    description: "Get ArgoCD app details",
  },
  {
    command: ["talosctl", "health"],
    description: "Check Talos cluster health",
  },
  { command: ["talosctl", "get"], description: "Get Talos resources" },
  { command: ["git", "log"], description: "View git log" },
  { command: ["git", "status"], description: "Check git status" },
  { command: ["git", "diff"], description: "View git diff" },
  { command: ["git", "show"], description: "Show git object" },
  { command: ["bun", "run", "typecheck"], description: "Run typecheck" },
  { command: ["bun", "run", "test"], description: "Run tests" },
  { command: ["bun", "run", "lint"], description: "Run linter" },
  { command: ["bunx", "eslint"], description: "Run ESLint" },
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
    permLogger.warn(
      { command: cmdString },
      "Unterminated quote in command",
    );
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
