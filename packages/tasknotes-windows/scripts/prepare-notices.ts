import { mkdir } from "node:fs/promises";
import path from "node:path";
import { preparedNoticeInputs } from "./prepared-notice-inputs.ts";

const packageRoot = path.resolve(import.meta.dir, "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: repositoryRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0)
    throw new Error("Facet notice generation failed.");
}
const noticeDir = path.join(packageRoot, "generated/notices");
await mkdir(noticeDir, { recursive: true });
const outputs = [
  "FirstPartyLicense.txt",
  "NuGetThirdPartyNotices.txt",
  "nuget-license-inventory.json",
].map((file) => `packages/tasknotes-windows/generated/notices/${file}`);
async function record(file: string): Promise<{ path: string; sha256: string }> {
  return {
    path: file,
    sha256: new Bun.CryptoHasher("sha256")
      .update(await Bun.file(path.join(repositoryRoot, file)).bytes())
      .digest("hex"),
  };
}
const beforePaths = await preparedNoticeInputs(repositoryRoot);
const inputRecords = await Promise.all(beforePaths.map((file) => record(file)));
await Bun.write(
  path.join(noticeDir, "FirstPartyLicense.txt"),
  await Bun.file(path.join(repositoryRoot, "LICENSE")).bytes(),
);
await run([
  "bun",
  "packages/tasknotes-windows/scripts/generate-nuget-notices.ts",
  Bun.argv[2] ??
    path.join(packageRoot, "src/TaskNotes.Windows.App/obj/project.assets.json"),
]);
const afterPaths = await preparedNoticeInputs(repositoryRoot);
const after = await Promise.all(afterPaths.map((file) => record(file)));
if (JSON.stringify(inputRecords) !== JSON.stringify(after))
  throw new Error(
    "Notice source inputs changed during generation. Generate one coherent checkpoint again.",
  );
const outputRecords = await Promise.all(outputs.map((file) => record(file)));
const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
const item = (kind: string, entry: { path: string; sha256: string }): string =>
  `<${kind} Include="$(MSBuildThisFileDirectory)${escape(path.relative(noticeDir, path.join(repositoryRoot, entry.path)).replaceAll("\\", "/"))}" ExpectedHash="${entry.sha256.toUpperCase()}" />`;
await Bun.write(
  path.join(noticeDir, "prepared-notices.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      platform: "windows",
      inputs: inputRecords,
      outputs: outputRecords,
    },
    null,
    2,
  ) + "\n",
);
await Bun.write(
  path.join(noticeDir, "prepared-notices.props"),
  `<Project><PropertyGroup><FacetPreparedNoticeVersion>1</FacetPreparedNoticeVersion></PropertyGroup><ItemGroup>\n${inputRecords.map((entry) => item("FacetNoticeInput", entry)).join("\n")}\n${outputRecords.map((entry) => item("FacetNoticeOutput", entry)).join("\n")}\n</ItemGroup></Project>\n`,
);
await Bun.write(
  Bun.stdout,
  `Prepared notices: ${String(inputRecords.length)} source hashes and ${String(outputRecords.length)} output hashes.\n`,
);
