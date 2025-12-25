/**
 * Agent Bridge - Runs inside the sandbox container
 *
 * Communication protocol:
 * - Receives JSON messages via stdin (one per line)
 * - Sends JSON messages via stdout (NDJSON format)
 *
 * Input message types:
 *   { type: 'prompt', content: string }
 *   { type: 'interrupt' }
 *
 * Output: Streams all SDK messages as JSON lines
 */

import { query } from "@anthropic-ai/claude-code";
import { execSync } from "child_process";

// Environment variables passed from host
const REPO_URL = process.env.REPO_URL;
const BASE_BRANCH = process.env.BASE_BRANCH || "main";
const BRANCH = process.env.BRANCH; // Working branch (auto-generated)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIT_USER_NAME = process.env.GIT_USER_NAME || "Claude Web";
const GIT_USER_EMAIL = process.env.GIT_USER_EMAIL || "claude@example.com";
const SESSION_ID = process.env.SESSION_ID;

// Track current query for interruption
let currentAbortController = null;

// Track SDK session ID for conversation resumption
let sdkSessionId = null;

/**
 * Configure git credentials and clone the repository
 */
async function setupRepository() {
  // Configure git user
  execSync(`git config --global user.name "${GIT_USER_NAME}"`);
  execSync(`git config --global user.email "${GIT_USER_EMAIL}"`);

  // Configure credential helper for GitHub token
  if (GITHUB_TOKEN) {
    execSync("git config --global credential.helper store");
    const credentialUrl = `https://oauth2:${GITHUB_TOKEN}@github.com`;
    execSync(`echo "${credentialUrl}" > ~/.git-credentials`);
  }

  // Clone repository if URL provided
  if (REPO_URL) {
    console.error(`[agent-bridge] Cloning ${REPO_URL}...`);

    // Add token to URL for cloning
    let cloneUrl = REPO_URL;
    if (GITHUB_TOKEN && REPO_URL.startsWith("https://github.com")) {
      cloneUrl = REPO_URL.replace("https://github.com", `https://oauth2:${GITHUB_TOKEN}@github.com`);
    }

    try {
      // Clone with the base branch
      execSync(`git clone -b ${BASE_BRANCH} ${cloneUrl} /workspace`, { stdio: "pipe" });

      // Create and checkout the working branch
      if (BRANCH) {
        execSync(`git checkout -b ${BRANCH}`, { cwd: "/workspace", stdio: "pipe" });
        console.error(`[agent-bridge] Repository ready on branch: ${BRANCH} (based on ${BASE_BRANCH})`);
      } else {
        console.error(`[agent-bridge] Repository ready on branch: ${BASE_BRANCH}`);
      }
    } catch (error) {
      console.error(`[agent-bridge] Failed to clone repository:`, error);
      throw error;
    }
  }
}


/**
 * Handle a prompt message from the host
 */
async function handlePrompt(content) {
  currentAbortController = new AbortController();

  try {
    // Build options, including resume if we have a session ID
    const options = {
      cwd: "/workspace",
      permissionMode: "bypassPermissions",
      dangerouslySkipPermissions: true,
      maxTurns: 100,
    };

    // Resume the conversation if we have a session ID from a previous query
    if (sdkSessionId) {
      options.resume = sdkSessionId;
    }

    const queryGenerator = query({
      prompt: content,
      abortController: currentAbortController,
      options,
    });

    for await (const message of queryGenerator) {
      // Capture SDK session ID from init message for conversation resumption
      if (message.type === "system" && message.subtype === "init" && message.session_id) {
        sdkSessionId = message.session_id;
        console.error(`[agent-bridge] Captured SDK session ID: ${sdkSessionId}`);
      }

      // Send each message as a JSON line to stdout
      console.log(JSON.stringify(message));
    }
  } catch (error) {
    if (error.name === "AbortError") {
      console.log(JSON.stringify({ type: "interrupted" }));
    } else {
      console.log(
        JSON.stringify({
          type: "error",
          error: error.message,
        })
      );
    }
  } finally {
    currentAbortController = null;
  }
}

/**
 * Handle an interrupt message from the host
 */
function handleInterrupt() {
  if (currentAbortController) {
    currentAbortController.abort();
    console.error("[agent-bridge] Query interrupted");
  }
}

/**
 * Parse and handle incoming messages from stdin
 */
function processLine(line) {
  if (!line.trim()) return;

  try {
    const message = JSON.parse(line);

    switch (message.type) {
      case "prompt":
        handlePrompt(message.content);
        break;
      case "interrupt":
        handleInterrupt();
        break;
      default:
        console.error(`[agent-bridge] Unknown message type: ${message.type}`);
    }
  } catch (error) {
    console.error(`[agent-bridge] Failed to parse message: ${line}`);
  }
}

/**
 * Main entry point
 */
async function main() {
  console.error(`[agent-bridge] Starting session: ${SESSION_ID}`);

  // Setup repository
  await setupRepository();

  // Send ready signal
  console.log(JSON.stringify({ type: "ready", sessionId: SESSION_ID }));

  // Read from stdin line by line
  process.stdin.setEncoding("utf8");

  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      processLine(line);
    }
  });

  process.stdin.on("end", () => {
    console.error("[agent-bridge] stdin closed, exiting");
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("[agent-bridge] Fatal error:", error);
  process.exit(1);
});
