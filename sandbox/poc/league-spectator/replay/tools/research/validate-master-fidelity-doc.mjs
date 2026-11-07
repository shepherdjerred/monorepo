import { resolve, dirname } from "node:path";
const doc = "sandbox/poc/league-spectator/replay/AV-FIDELITY-MAP.md",
  readme = "sandbox/poc/league-spectator/replay/README.md",
  text = await Bun.file(doc).text();
const ids = [...text.matchAll(/^### (F\d\d) /gm)].map((m) => m[1]),
  expected = Array.from(
    { length: 16 },
    (_, i) => "F" + String(i + 1).padStart(2, "0"),
  );
if (JSON.stringify(ids) !== JSON.stringify(expected))
  throw Error("All16capabilityrequirements required");
if ((text.match(/\*\*Closes when:\*\*/g) ?? []).length !== 16)
  throw Error("Everyworkstreamrequiresclosureevidence");
if ((text.match(/^```/gm) ?? []).length % 2)
  throw Error("Unbalancedcodefences");
const links = [];
for (const m of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
  const target = m[1];
  if (/^(https?:|#)/.test(target)) continue;
  const path = resolve(dirname(doc), target.split("#")[0]);
  if (!(await Bun.file(path).exists()))
    throw Error("Missingdocumentlink " + target);
  links.push(target);
}
if (
  !(await Bun.file(readme).text()).includes(
    "[master fidelity map](AV-FIDELITY-MAP.md)",
  )
)
  throw Error("READMEentrypointmissing");
const archive = await Bun.file(
    ".cache/replay-spike/research/direct-effects-v39-r2-archive.json",
  ).json(),
  entries = archive.artifacts.filter((e) => e.sourcePath === resolve(readme));
console.log(
  JSON.stringify(
    {
      requirements: ids,
      closureCriteria: 16,
      relativeLinks: links.length,
      missingLinks: 0,
      lines: text.split("\n").length,
      archivedReadmeEntries: entries.map((e) => ({
        kind: e.kind,
        path: e.archivePath,
      })),
    },
    null,
    2,
  ),
);
