#!/usr/bin/env bun

/**
 * commit-msg hook to enforce conventional commits with required scopes.
 * Format: type(scope): description  OR  type(scope)!: description
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateCommitMessage } from "./lib/commit-message.ts";

async function main(): Promise<void> {
  const commitMsgFile = process.argv[2];
  if (!commitMsgFile) {
    console.error("Usage: validate-commit-msg.ts <commit-msg-file>");
    process.exit(1);
  }

  const rawMessage = await readFile(commitMsgFile, "utf8");
  const validation = await validateCommitMessage(
    rawMessage,
    path.join(import.meta.dirname, ".."),
  );
  if (!validation.valid) {
    console.error(validation.error);
    console.error("");
    process.exit(1);
  }
}

await main();
