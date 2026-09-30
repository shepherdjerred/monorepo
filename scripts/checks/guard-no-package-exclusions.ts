#!/usr/bin/env bun

import { readFile } from "node:fs/promises";

type Check = {
  file: string;
  pattern: RegExp;
  message: string;
};

const checks: Check[] = [
  {
    file: "package.json",
    pattern: /"!\s*packages\//,
    message:
      "Root workspace contains '!packages/...'. All packages must be integrated.",
  },
];

async function main(): Promise<void> {
  const failures: string[] = [];

  for (const check of checks) {
    const content = await readFile(check.file, "utf8");
    if (check.pattern.test(content)) {
      failures.push(`${check.file}: ${check.message}`);
    }
  }

  if (failures.length > 0) {
    console.error("Package integration guard failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Package integration guard passed.");
}

await main();
