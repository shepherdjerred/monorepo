import { lint } from "markdownlint-cli2/markdownlint/promise";
import parseJsonc from "markdownlint-cli2/parsers/jsonc";
const files = [
  "sandbox/poc/league-spectator/replay/AV-FIDELITY-MAP.md",
  "sandbox/poc/league-spectator/replay/README.md",
];
const { config } = parseJsonc(
  await Bun.file(".markdownlint-cli2.jsonc").text(),
);
const result = await lint({ files, config }),
  checked = Object.keys(result),
  issues = Object.entries(result).flatMap(([file, rows]) =>
    rows.map((row) => ({ file, ...row })),
  );
if (checked.length !== 2)
  throw Error("Both explicit Markdown inputs must be checked");
console.log(
  JSON.stringify(
    { checked, issues: issues.length, details: issues.slice(0, 10) },
    null,
    2,
  ),
);
if (issues.length) process.exitCode = 1;
