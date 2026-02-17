import {
  dag,
  type Container,
  type Secret,
  ReturnType,
} from "@dagger.io/dagger";
import versions from "../versions";
import type { ExecResult } from "../utils/errors";
import { getGitHubContainer } from "./github";

// Pin Claude Code CLI version for reproducible builds
const CLAUDE_CODE_VERSION = "1.0.33";
// GitHub CLI version (same as getGitHubContainer)
const GH_CLI_VERSION = "2.63.2";

/**
 * Options for creating a Claude Code container
 */
export type ClaudeContainerOptions = {
  /** Claude Code CLI version (defaults to pinned version) */
  claudeVersion?: string | undefined;
  /** Node.js version (defaults to versions.node) */
  nodeVersion?: string | undefined;
  /** GitHub CLI version (defaults to 2.63.2) */
  ghVersion?: string | undefined;
};

/**
 * Authentication options for Claude Code
 */
export type ClaudeAuthOptions = {
  /** Anthropic API key for direct API access */
  anthropicApiKey?: Secret | undefined;
  /** Claude Code OAuth token for authenticated access */
  claudeOauthToken?: Secret | undefined;
};

/**
 * Options for running Claude Code
 */
export type ClaudeRunOptions = {
  /** The prompt to send to Claude */
  prompt: string;
  /** Model to use (defaults to claude-sonnet-4-20250514) */
  model?: string | undefined;
  /** Maximum number of agentic turns */
  maxTurns?: number | undefined;
  /** JSON schema for structured output */
  jsonSchema?: string | undefined;
  /** Extra CLI arguments */
  extraArgs?: string[] | undefined;
};

/**
 * Options for posting a PR review
 */
export type PostReviewOptions = {
  /** GitHub token for authentication */
  githubToken: Secret;
  /** Repository (e.g., "owner/repo") */
  repository: string;
  /** PR number */
  prNumber: number;
  /** Review action: approve or request-changes */
  action: "approve" | "request-changes";
  /** Review body text */
  body: string;
};

/**
 * Individual inline comment for batched review
 */
export type InlineComment = {
  /** File path relative to repo root */
  path: string;
  /** Line number in the file */
  line: number;
  /** Side of the diff: LEFT for deletions, RIGHT for additions */
  side: "LEFT" | "RIGHT";
  /** Comment body text */
  body: string;
};

/**
 * Options for posting a batched review with inline comments
 */
export type BatchedReviewOptions = {
  /** GitHub token for authentication */
  githubToken: Secret;
  /** Repository (e.g., "owner/repo") */
  repository: string;
  /** PR number */
  prNumber: number;
  /** Commit SHA to comment on */
  commitId: string;
  /** Review event: APPROVE, REQUEST_CHANGES, or COMMENT */
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  /** Overall review body */
  body: string;
  /** Inline comments to post */
  comments: InlineComment[];
};

/**
 * Options for posting a simple PR comment
 */
export type PostCommentOptions = {
  /** GitHub token for authentication */
  githubToken: Secret;
  /** Repository (e.g., "owner/repo") */
  repository: string;
  /** PR number */
  prNumber: number;
  /** Comment body text */
  body: string;
};

/**
 * Structured review verdict from Claude
 */
export type ReviewVerdict = {
  /** Whether to approve the PR */
  should_approve: boolean;
  /** Confidence level 0-100 */
  confidence: number;
  /** Issue counts by severity */
  issue_count: {
    critical: number;
    major: number;
    minor: number;
    nitpick: number;
  };
  /** Brief explanation of the decision */
  reasoning: string;
  /** Inline comments to post on specific lines */
  inline_comments: InlineComment[];
};

/**
 * JSON schema for structured review output
 */
export const REVIEW_VERDICT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    should_approve: {
      type: "boolean",
      description: "Whether to approve the PR (true) or not (false)",
    },
    confidence: {
      type: "number",
      description: "Confidence level 0-100 in the approval decision",
    },
    issue_count: {
      type: "object",
      properties: {
        critical: { type: "number" },
        major: { type: "number" },
        minor: { type: "number" },
        nitpick: { type: "number" },
      },
      required: ["critical", "major", "minor", "nitpick"],
    },
    reasoning: {
      type: "string",
      description: "Brief explanation of the approval/rejection decision",
    },
    inline_comments: {
      type: "array",
      description: "Inline comments to post on specific lines of code",
      items: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to repo root",
          },
          line: {
            type: "number",
            description: "Line number in the file",
          },
          side: {
            type: "string",
            enum: ["LEFT", "RIGHT"],
            description:
              "Side of the diff: LEFT for deletions, RIGHT for additions",
          },
          body: {
            type: "string",
            description: "Comment body text",
          },
        },
        required: ["path", "line", "side", "body"],
      },
    },
  },
  required: [
    "should_approve",
    "confidence",
    "issue_count",
    "reasoning",
    "inline_comments",
  ],
});

/**
 * Helper to install GitHub CLI in a container.
 * Downloads the .deb package and installs it.
 *
 * @param container - The container to install gh CLI into
 * @param ghVersion - GitHub CLI version (defaults to 2.63.2)
 * @returns Container with gh CLI installed
 */
export function withGhCli(
  container: Container,
  ghVersion = GH_CLI_VERSION,
): Container {
  return container
    .withExec([
      "sh",
      "-c",
      `curl -L -o ghcli.deb https://github.com/cli/cli/releases/download/v${ghVersion}/gh_${ghVersion}_linux_amd64.deb`,
    ])
    .withExec(["dpkg", "-i", "ghcli.deb"])
    .withExec(["rm", "ghcli.deb"]);
}

/**
 * Returns a container with Claude Code CLI and git installed.
 * Useful for running automated code reviews and AI-assisted operations.
 *
 * @param options - Configuration options for the container
 * @returns A configured container with Claude Code CLI
 *
 * @example
 * ```ts
 * const container = getClaudeContainer()
 *   .withSecretVariable("ANTHROPIC_API_KEY", apiKey)
 *   .withExec(["claude", "--print", "Hello, Claude!"]);
 * ```
 */
export function getClaudeContainer(
  options: ClaudeContainerOptions = {},
): Container {
  const nodeVersion = options.nodeVersion ?? versions.node;
  const claudeVersion = options.claudeVersion ?? CLAUDE_CODE_VERSION;
  const ghVersion = options.ghVersion ?? GH_CLI_VERSION;

  let container = dag
    .container()
    .from(`node:${nodeVersion}-bookworm`)
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "git", "jq", "curl"])
    // Cache npm packages
    .withMountedCache("/root/.npm", dag.cacheVolume("claude-code-npm-cache"))
    // Install Claude Code CLI
    .withExec([
      "npm",
      "install",
      "-g",
      `@anthropic-ai/claude-code@${claudeVersion}`,
    ])
    // Configure git user
    .withExec(["git", "config", "--global", "user.name", "dagger-bot"])
    .withExec(["git", "config", "--global", "user.email", "dagger@localhost"])
    // Verify installation
    .withExec(["claude", "--version"])
    .withWorkdir("/workspace");

  // Install GitHub CLI
  container = withGhCli(container, ghVersion);

  return container;
}

/**
 * Adds Claude Code authentication to a container.
 *
 * @param container - The container to add auth to
 * @param auth - Authentication options
 * @returns Container with authentication configured
 */
export function withClaudeAuth(
  container: Container,
  auth: ClaudeAuthOptions,
): Container {
  let result = container;

  if (auth.anthropicApiKey) {
    result = result.withSecretVariable(
      "ANTHROPIC_API_KEY",
      auth.anthropicApiKey,
    );
  }

  if (auth.claudeOauthToken) {
    result = result.withSecretVariable(
      "CLAUDE_CODE_OAUTH_TOKEN",
      auth.claudeOauthToken,
    );
  }

  return result;
}

/**
 * Chains a Claude Code execution onto a container.
 * Does NOT call stdout() - preserves composability.
 *
 * @param container - The container to run Claude in
 * @param options - Run options
 * @returns Container with Claude execution added
 */
export function withClaudeRun(
  container: Container,
  options: ClaudeRunOptions,
): Container {
  const args = ["claude", "--print", "--dangerously-skip-permissions"];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.maxTurns !== undefined) {
    args.push("--max-turns", options.maxTurns.toString());
  }

  if (options.jsonSchema) {
    args.push("--json-schema", options.jsonSchema);
  }

  if (options.extraArgs) {
    args.push(...options.extraArgs);
  }

  args.push(options.prompt);

  // Use ReturnType.Any so executeClaudeRun can capture exit code without throwing
  return container.withExec(args, { expect: ReturnType.Any });
}

/**
 * Terminal operation: executes Claude and captures stdout, stderr, exitCode.
 * The container should have been set up with withClaudeRun().
 *
 * @param container - Container with Claude run already configured (via withClaudeRun)
 * @returns ExecResult with stdout, stderr, and exitCode
 */
export async function executeClaudeRun(
  container: Container,
): Promise<ExecResult> {
  const synced = await container.sync();

  const [stdout, stderr, exitCode] = await Promise.all([
    synced.stdout(),
    synced.stderr(),
    synced.exitCode(),
  ]);

  return { stdout, stderr, exitCode };
}

/**
 * Post a PR review (approve or request-changes) using gh CLI.
 *
 * @param options - Review options
 * @returns The gh CLI output
 */
export async function postReview(options: PostReviewOptions): Promise<string> {
  const container = getGitHubContainer()
    .withSecretVariable("GH_TOKEN", options.githubToken)
    .withExec([
      "gh",
      "pr",
      "review",
      options.prNumber.toString(),
      `--repo=${options.repository}`,
      `--${options.action}`,
      "--body",
      options.body,
    ]);

  return container.stdout();
}

/**
 * Post a batched review with inline comments via GitHub API.
 * This creates a single notification instead of one per comment.
 *
 * @param options - Batched review options
 * @returns The API response
 */
export async function postBatchedReview(
  options: BatchedReviewOptions,
): Promise<string> {
  // Build the API request body
  const requestBody = {
    commit_id: options.commitId,
    body: options.body,
    event: options.event,
    comments: options.comments.map((c) => ({
      path: c.path,
      line: c.line,
      side: c.side,
      body: c.body,
    })),
  };

  // Write request body to a file and use --input to read it
  const container = getGitHubContainer()
    .withSecretVariable("GH_TOKEN", options.githubToken)
    .withNewFile("/tmp/review-request.json", JSON.stringify(requestBody))
    .withExec([
      "gh",
      "api",
      "--method=POST",
      "-H=Accept: application/vnd.github+json",
      "-H=X-GitHub-Api-Version: 2022-11-28",
      `/repos/${options.repository}/pulls/${options.prNumber}/reviews`,
      "--input=/tmp/review-request.json",
    ]);

  return container.stdout();
}

/**
 * Post a simple PR comment using gh CLI.
 *
 * @param options - Comment options
 * @returns The gh CLI output
 */
export async function postComment(
  options: PostCommentOptions,
): Promise<string> {
  const container = getGitHubContainer()
    .withSecretVariable("GH_TOKEN", options.githubToken)
    .withExec([
      "gh",
      "pr",
      "comment",
      options.prNumber.toString(),
      `--repo=${options.repository}`,
      "--body",
      options.body,
    ]);

  return container.stdout();
}
