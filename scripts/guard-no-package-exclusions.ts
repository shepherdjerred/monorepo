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
  {
    file: ".dagger/src/index.ts",
    pattern: /\bEXCLUDED\s*=/,
    message: "Dagger quality checks contain an EXCLUDED package list.",
  },
  {
    file: ".dagger/src/index.ts",
    pattern: /Skip exempt packages/,
    message: "Dagger compliance logic still mentions exempt packages.",
  },
  {
    file: "scripts/compliance-check.sh",
    pattern: /\bcase\s+"\$PKG"\s+in|continue\s*;;/,
    message: "Compliance check contains package exemption branching.",
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
