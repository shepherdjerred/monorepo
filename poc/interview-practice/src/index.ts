#!/usr/bin/env bun

import { loadConfig } from "./config.ts";
import { handleLeetcodeCommand } from "./handlers/leetcode.ts";
import { handleSystemDesignCommand } from "./handlers/system-design.ts";
import { handleQuestionsCommand } from "./handlers/questions.ts";

function printUsage(): void {
  console.log(`
interview-practice - AI-powered coding interview practice

Usage:
  interview-practice <command> [subcommand] [options]

Commands:
  leetcode start [options]     Start a leetcode-style interview session
    -d, --difficulty <level>   easy | medium | hard
    -l, --language <lang>      ts | java | py | go | rs | cpp (default: ts)
    -t, --time <minutes>       Session duration (default: 25)
    -q, --question <slug>      Specific question slug
    --voice                    Enable voice mode (OpenAI Realtime, ~$5/session)

  leetcode resume <id>         Resume a previous session
  leetcode history             List past sessions

  system-design start [options] Start a system design interview session
    -d, --difficulty <level>   junior | mid | senior | staff
    -t, --time <minutes>       Session duration (default: 45)
    -q, --question <slug>      Specific question slug
    --voice                    Enable voice mode (OpenAI Realtime, ~$5/session)

  questions list               List available questions

Options:
  --help, -h                   Show this help

Environment Variables:
  AI_PROVIDER                  anthropic | openai | google (default: anthropic)
  CONVERSATION_MODEL           Model to use (default: claude-sonnet-4-6-20260217)
  ANTHROPIC_API_KEY            Anthropic API key
  DATA_DIR                     Data directory (default: ~/.interview-practice)

Examples:
  interview-practice leetcode start -d medium -l java
  interview-practice leetcode start -q two-sum -l ts
  interview-practice system-design start -d senior -q url-shortener
  interview-practice questions list
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];

  if (
    command == null ||
    command.length === 0 ||
    command === "--help" ||
    command === "-h"
  ) {
    printUsage();
    process.exit(0);
  }

  const config = loadConfig();

  switch (command) {
    case "leetcode":
      await handleLeetcodeCommand(subcommand, args.slice(2), config);
      break;
    case "system-design":
      await handleSystemDesignCommand(subcommand, args.slice(2), config);
      break;
    case "questions":
      await handleQuestionsCommand(subcommand, args.slice(2), config);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error("Fatal error:", error);
  process.exit(1);
}
