import { stat } from "node:fs/promises";
const { size } = await stat(new URL("../dist/index.html", import.meta.url));
if (size >= 1_000_000)
  throw new Error(`Initial HTML exceeds 1 MB: ${String(size)} bytes`);
process.stdout.write(
  `Initial HTML: ${String(size)} bytes (budget: 1,000,000)\n`,
);
