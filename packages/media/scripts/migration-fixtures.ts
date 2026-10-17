import snapshot from "#migration/fixtures/resolved-profiles.json";
import cases from "#migration/fixtures/source-parse.json";
import { observeSourceRegexes } from "./migration-regex-oracle.ts";

const requests = new Map<string, { pattern: string; value: string }>();
for (const test of cases.cases) {
  const inventory = snapshot.inventories.find(
    (item) => item.source === test.source,
  );
  if (inventory === undefined) throw new Error("Source fixture missing");
  for (const format of inventory.customFormats) {
    for (const spec of format.specifications) {
      const pattern = spec.fields[0]?.value;
      if (typeof pattern !== "string") continue;
      const values =
        spec.implementation === "ReleaseGroupSpecification"
          ? [test.releaseGroup]
          : [test.releaseTitle, ""];
      for (const value of values) {
        const request = { pattern, value };
        requests.set(JSON.stringify(request), request);
      }
    }
  }
}
const evidence = await observeSourceRegexes([...requests.values()]);
await Bun.write(
  new URL("../src/migration/fixtures/regex-observations.json", import.meta.url),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.warn(
  `Recorded ${String(evidence.observations.length)} bounded regex observations.`,
);
