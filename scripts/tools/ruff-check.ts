import { run } from "../lib/run.ts";

// renovate: datasource=pypi depName=ruff
const RUFF_VERSION = "0.16.9";

export async function checkRuff(): Promise<void> {
  await run(["uvx", `ruff@${RUFF_VERSION}`, "check", "."]);
}

if (import.meta.main) {
  await checkRuff();
}
