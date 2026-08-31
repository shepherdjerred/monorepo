import { runUiTests } from "./ui-test-harness.ts";

const requested = Bun.argv.slice(2);
const testSelectors = requested.map((test) => `-only-testing:${test}`);

process.exit(await runUiTests({ testSelectors }));
