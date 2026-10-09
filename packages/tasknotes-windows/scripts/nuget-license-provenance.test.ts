import path from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, copyFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  NuGetLicenseProvenance,
  publisherLicenseFor,
  verifiedLicenseText,
  verifiedPublisherLicenseText,
} from "./nuget-license-provenance.ts";
import { preparedNoticeInputs } from "./prepared-notice-inputs.ts";

const catalog = NuGetLicenseProvenance.parse(
  await Bun.file(
    path.join(import.meta.dir, "license-texts/provenance.json"),
  ).json(),
);
const pinned = catalog.publisherLicenses[0];
if (pinned === undefined)
  throw new Error("The exact-version publisher provenance fixture is missing.");
const source = () =>
  publisherLicenseFor(catalog.publisherLicenses, pinned.dependency, pinned);
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
async function noticeItem(kind: string, file: string): Promise<string> {
  const bytes = await Bun.file(file).bytes();
  const hash = new Bun.CryptoHasher("sha256")
    .update(bytes)
    .digest("hex")
    .toUpperCase();
  return `<${kind} Include="${escape(file)}" ExpectedHash="${hash}" />`;
}

describe("exact publisher URL package provenance", () => {
  test("the cached producer hashes every prepared-notice source input", async () => {
    const repositoryRoot = path.resolve(import.meta.dir, "../../..");
    const packageConfig = z
      .object({
        tasks: z.object({
          generate: z.object({
            inputs: z.array(z.string()),
            outputs: z.array(z.string()),
          }),
        }),
      })
      .parse(
        Bun.JSONC.parse(
          await Bun.file(path.join(import.meta.dir, "../turbo.json")).text(),
        ),
      );
    const rootConfig = z
      .object({ globalDependencies: z.array(z.string()) })
      .parse(
        Bun.JSONC.parse(
          await Bun.file(path.join(repositoryRoot, "turbo.json")).text(),
        ),
      );
    const patterns = [
      ...rootConfig.globalDependencies,
      ...packageConfig.tasks.generate.inputs.map((input) =>
        input.startsWith("$TURBO_ROOT$/")
          ? input.slice("$TURBO_ROOT$/".length)
          : `packages/tasknotes-windows/${input}`,
      ),
    ].map((input) => new Bun.Glob(input));
    for (const input of await preparedNoticeInputs(repositoryRoot))
      expect(
        patterns.some((pattern) => pattern.match(input)),
        input,
      ).toBe(true);
    expect(packageConfig.tasks.generate.outputs).toEqual([
      "generated/notices/**",
    ]);
  });

  test("binds the captured license only to the exact locked package", async () => {
    expect(source()).toEqual(pinned);
    const bytes = await Bun.file(
      path.join(import.meta.dir, "license-texts", pinned.file),
    ).bytes();
    const text = verifiedLicenseText(pinned, bytes, pinned.dependency);
    const raw = await Bun.file(
      path.join(import.meta.dir, "license-texts", pinned.sourceFile),
    ).bytes();
    expect(
      verifiedPublisherLicenseText(pinned, raw, bytes, pinned.dependency),
    ).toEqual(text);
    expect(text).toContain("EULAID:WIN10SDK.RTM.AUG_2018_en-US");
    expect(text).toContain("MICROSOFT SOFTWARE LICENSE TERMS");
  });

  test.each([
    {
      name: "changed version",
      ...pinned,
      dependency: "Microsoft.Windows.SDK.BuildTools/10.0.28000.2705",
    },
    {
      name: "changed content hash",
      ...pinned,
      packageSha512: "different-restored-content",
    },
    { name: "changed nuspec", ...pinned, nuspecSha256: "0".repeat(64) },
    {
      name: "unpinned publisher URL",
      ...pinned,
      licenseUrl:
        "https://www.nuget.org/packages/Microsoft.Windows.SDK.BuildTools/10.0.28000.2526",
    },
    { name: "missing publisher URL", ...pinned, licenseUrl: undefined },
  ])("rejects $name", (metadata) => {
    expect(() =>
      publisherLicenseFor(
        catalog.publisherLicenses,
        metadata.dependency,
        metadata,
      ),
    ).toThrow();
  });

  test("rejects modified local license text", async () => {
    const bytes = await Bun.file(
      path.join(import.meta.dir, "license-texts", pinned.file),
    ).bytes();
    const changed = new Uint8Array(bytes.length + 1);
    changed.set(bytes);
    expect(() =>
      verifiedLicenseText(pinned, changed, pinned.dependency),
    ).toThrow("pinned license asset changed");
  });

  test("rejects changed and missing raw publisher source bytes", async () => {
    const text = await Bun.file(
      path.join(import.meta.dir, "license-texts", pinned.file),
    ).bytes();
    const raw = await Bun.file(
      path.join(import.meta.dir, "license-texts", pinned.sourceFile),
    ).bytes();
    const changed = new Uint8Array(raw.length + 1);
    changed.set(raw);
    expect(() =>
      verifiedPublisherLicenseText(pinned, changed, text, pinned.dependency),
    ).toThrow("captured publisher license source changed");
    expect(() =>
      verifiedPublisherLicenseText(
        pinned,
        new Uint8Array(),
        text,
        pinned.dependency,
      ),
    ).toThrow("captured publisher license source changed");
  });

  test("never supplies this license for a foreign package", () => {
    expect(
      publisherLicenseFor(
        catalog.publisherLicenses,
        "Other.BuildTools/10.0.28000.2526",
        pinned,
      ),
    ).toBeUndefined();
  });

  test("rejects duplicate, malformed and extra publisher provenance fields", () => {
    expect(() =>
      NuGetLicenseProvenance.parse({
        ...catalog,
        publisherLicenses: [pinned, pinned],
      }),
    ).toThrow();
    expect(() =>
      NuGetLicenseProvenance.parse({
        ...catalog,
        publisherLicenses: [{ ...pinned, nuspecSha256: "bad" }],
      }),
    ).toThrow();
    expect(() =>
      NuGetLicenseProvenance.parse({
        ...catalog,
        publisherLicenses: [{ ...pinned, wildcard: true }],
      }),
    ).toThrow();
  });
});

describe("prepared-notice production input verification", () => {
  test("the real prepared-notice MSBuild gate rejects a changed production helper", async () => {
    const repositoryRoot = path.resolve(import.meta.dir, "../../..");
    const fixtureRoot = await mkdtemp(
      path.join(tmpdir(), "facet-notice-input-gate-"),
    );
    const inputs = await preparedNoticeInputs(repositoryRoot);
    for (const relative of inputs) {
      const target = path.join(fixtureRoot, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(repositoryRoot, relative), target);
    }
    const declared = await preparedNoticeInputs(fixtureRoot);
    const helper =
      "packages/tasknotes-windows/scripts/nuget-license-provenance.ts";
    expect(declared).toContain(helper);
    expect(declared).toContain(
      "packages/tasknotes-windows/scripts/prepared-notice-inputs.ts",
    );
    const inputItems = await Promise.all(
      declared.map((relative) =>
        noticeItem("FacetNoticeInput", path.join(fixtureRoot, relative)),
      ),
    );
    const outputNames = [
      "FirstPartyLicense.txt",
      "ThirdPartyNotices.txt",
      "native-license-inventory.json",
      "NuGetThirdPartyNotices.txt",
      "nuget-license-inventory.json",
    ];
    const outputItems = await Promise.all(
      outputNames.map((name) =>
        noticeItem(
          "FacetNoticeOutput",
          path.join(import.meta.dir, "../generated/notices", name),
        ),
      ),
    );
    const project = await Bun.file(
      path.join(
        repositoryRoot,
        "packages/tasknotes-windows/src/TaskNotes.Windows.App/TaskNotes.Windows.App.csproj",
      ),
    ).text();
    const target =
      /<Target Name="VerifyPreparedFacetNotices">[\s\S]*?<\/Target>/u.exec(
        project,
      )?.[0];
    if (target === undefined)
      throw new Error("The production prepared-notice target is missing.");
    const gateProject = path.join(fixtureRoot, "NoticeGate.proj");
    await Bun.write(
      gateProject,
      `<Project><PropertyGroup><FacetPreparedNotices>true</FacetPreparedNotices><FacetPreparedNoticeVersion>1</FacetPreparedNoticeVersion></PropertyGroup><ItemGroup>${inputItems.join("")}${outputItems.join("")}</ItemGroup>${target}</Project>`,
    );
    const runGate = async () => {
      const command = Bun.spawn(
        [
          "dotnet",
          "msbuild",
          gateProject,
          "-target:VerifyPreparedFacetNotices",
          "-nologo",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, exit] = await Promise.all([
        new Response(command.stdout).text(),
        new Response(command.stderr).text(),
        command.exited,
      ]);
      return { exit, text: stdout + stderr };
    };
    const before = await runGate();
    expect(before.exit, before.text).toBe(0);
    const helperPath = path.join(fixtureRoot, helper);
    await Bun.write(
      helperPath,
      `${await Bun.file(helperPath).text()}\n// changed after notices were prepared\n`,
    );
    const after = await runGate();
    expect(after.exit).not.toBe(0);
    expect(after.text).toContain(
      "Prepared Facet notice source/output is missing or stale",
    );
    expect(after.text).toContain(helperPath);
  });
});
