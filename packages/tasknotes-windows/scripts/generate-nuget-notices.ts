import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import {
  NuGetLicenseProvenance,
  publisherLicenseFor,
  verifiedLicenseText,
  verifiedPublisherLicenseText,
} from "./nuget-license-provenance.ts";

const Library = z.object({
  type: z.string(),
  path: z.string().optional(),
  sha512: z.string().optional(),
  files: z.array(z.string()).optional(),
});
const Assets = z.object({
  packageFolders: z.record(z.string(), z.unknown()),
  libraries: z.record(z.string(), Library),
  targets: z.record(z.string(), z.record(z.string(), z.looseObject({}))),
});
const Metadata = z.looseObject({
  id: z.string(),
  version: z.string(),
  copyright: z.string().optional(),
  licenseUrl: z.string().optional(),
  license: z
    .union([
      z.string(),
      z.looseObject({ type: z.string(), "#text": z.string() }),
    ])
    .transform((license) =>
      typeof license === "string"
        ? { type: "expression", text: license }
        : { type: license.type, text: license["#text"] },
    )
    .optional(),
  repository: z
    .looseObject({ url: z.string().optional(), commit: z.string().optional() })
    .optional(),
});
const Lock = z.object({
  version: z.literal(2),
  dependencies: z.record(
    z.string(),
    z.record(
      z.string(),
      z.looseObject({
        type: z.string(),
        resolved: z.string().optional(),
        contentHash: z.string().optional(),
      }),
    ),
  ),
});
const nuspec = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
});
const packageRoot = path.resolve(import.meta.dir, "..");
const assetsPath = path.resolve(
  Bun.argv[2] ??
    path.join(packageRoot, "src/TaskNotes.Windows.App/obj/project.assets.json"),
);
const output = path.resolve(
  Bun.argv[3] ?? path.join(packageRoot, "generated/notices"),
);
const assets = Assets.parse(await Bun.file(assetsPath).json());
const lock = Lock.parse(
  await Bun.file(
    path.join(path.dirname(path.dirname(assetsPath)), "packages.lock.json"),
  ).json(),
);
const provenance = NuGetLicenseProvenance.parse(
  await Bun.file(
    path.join(import.meta.dir, "license-texts/provenance.json"),
  ).json(),
);
const inventory: unknown[] = [];
const notices = [
  "Facet Windows third-party NuGet notices",
  "Generated from the locked restored Windows app dependency graph. First-party code remains GPL-3.0-only.",
];
const gaps: { dependency: string; message: string; runtime: boolean }[] = [];
const hash = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const inside = (root: string, relative: string): string => {
  const resolved = path.resolve(root, relative);
  if (
    relative.includes("\\") ||
    relative.startsWith("/") ||
    !resolved.startsWith(root + path.sep)
  )
    throw new Error("Unsafe package license path.");
  return resolved;
};

for (const [dependency, library] of Object.entries(assets.libraries).sort(
  ([a], [b]) => a.localeCompare(b),
)) {
  if (library.type !== "package") continue;
  if (
    library.path === undefined ||
    library.sha512 === undefined ||
    library.files === undefined
  )
    throw new Error(`Missing restored package provenance for ${dependency}.`);
  const [id, version] = dependency.split("/");
  if (id === undefined || version === undefined)
    throw new Error(`Invalid restored dependency identity: ${dependency}.`);
  if (
    !Object.values(lock.dependencies).some((target) =>
      Object.entries(target).some(
        ([name, entry]) =>
          name.toLowerCase() === id.toLowerCase() &&
          entry.resolved === version &&
          entry.contentHash === library.sha512,
      ),
    )
  )
    throw new Error(
      `The restored graph does not match the pinned app lock: ${dependency}.`,
    );
  let root: string | undefined;
  for (const folder of Object.keys(assets.packageFolders)) {
    const candidate = inside(path.resolve(folder), library.path);
    if (
      await Bun.file(
        path.join(candidate, `${id.toLowerCase()}.nuspec`),
      ).exists()
    ) {
      root = candidate;
      break;
    }
  }
  if (root === undefined)
    throw new Error(
      `Restore the pinned ${dependency} before producing notices.`,
    );
  const nuspecBytes = await Bun.file(
    path.join(root, `${id.toLowerCase()}.nuspec`),
  ).bytes();
  const parsed: unknown = nuspec.parse(new TextDecoder().decode(nuspecBytes));
  const metadata = z
    .object({ package: z.object({ metadata: Metadata }) })
    .parse(parsed).package.metadata;
  if (metadata.id !== id || metadata.version !== version)
    throw new Error(`Restored package identity changed: ${dependency}.`);
  // NuGet's locked content hash excludes signing changes; archive SHA512 can differ.
  const restored = z
    .object({ contentHash: z.string() })
    .parse(await Bun.file(path.join(root, ".nupkg.metadata")).json());
  if (restored.contentHash !== library.sha512)
    throw new Error(
      `Restored package integrity differs from project.assets.json: ${dependency}.`,
    );
  const runtime = Object.values(assets.targets).some((target) => {
    const entry = target[dependency];
    return (
      entry !== undefined &&
      ["runtime", "native", "runtimeTargets", "contentFiles"].some((key) =>
        Object.hasOwn(entry, key),
      )
    );
  });
  const declaration = metadata.license?.text;
  const files = library.files.filter((file) =>
    /(?:^|\/)(?:licen[sc]e|copying|notice|third[-_ ]?party[-_ ]?notices?)(?:[._-]|$)/iu.test(
      file,
    ),
  );
  if (
    metadata.license?.type === "file" &&
    !files.includes(metadata.license.text)
  )
    files.push(metadata.license.text);
  const sources: {
    path: string;
    sha256: string;
    source?: string;
    provenance?: "publisher-url";
    sourceSha256?: string;
  }[] = [];
  notices.push(
    `\n===== ${dependency} =====`,
    `Declared license: ${declaration ?? "See publisher license URL"}`,
    `Publisher copyright: ${metadata.copyright ?? "Not declared in package metadata"}`,
  );
  if (metadata.licenseUrl !== undefined)
    notices.push(`Publisher license URL: ${metadata.licenseUrl}`);
  for (const file of files.sort()) {
    const bytes = await Bun.file(inside(root, file)).bytes();
    if (bytes.length === 0 || bytes.length > 2_097_152)
      throw new Error(`Invalid notice file size: ${dependency}/${file}.`);
    sources.push({ path: file, sha256: hash(bytes) });
    notices.push(
      `\n--- Package file ${file} ---\n`,
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  }
  const hasLicense =
    metadata.license?.type === "file" ||
    files.some((file) =>
      /(?:^|\/)(?:licen[sc]e|copying)(?:[._-]|$)/iu.test(file),
    );
  if (!hasLicense) {
    const repositorySource = provenance.licenses.find(
      (item) =>
        item.repository === metadata.repository?.url &&
        item.commit === metadata.repository.commit,
    );
    const publisherSource = publisherLicenseFor(
      provenance.publisherLicenses,
      dependency,
      {
        packageSha512: library.sha512,
        nuspecSha256: hash(nuspecBytes),
        licenseUrl: metadata.licenseUrl,
      },
    );
    const source = repositorySource ?? publisherSource;
    if (source === undefined) {
      const gap = {
        dependency,
        runtime,
        message:
          "Package contains no license text and no exact repository-commit license source is recorded.",
      };
      gaps.push(gap);
      notices.push(
        `SOURCE GAP (${runtime ? "runtime" : "build dependency"}): ${gap.message}`,
      );
    } else {
      const bytes = await Bun.file(
        inside(path.join(import.meta.dir, "license-texts"), source.file),
      ).bytes();
      if (repositorySource !== undefined) {
        const text = verifiedLicenseText(source, bytes, dependency);
        sources.push({
          path: source.file,
          source: source.source,
          sha256: hash(bytes),
        });
        notices.push(
          `\n--- Upstream license at the package's exact declared repository commit: ${source.source} ---\n`,
          text,
        );
      } else if (publisherSource !== undefined) {
        const raw = await Bun.file(
          inside(
            path.join(import.meta.dir, "license-texts"),
            publisherSource.sourceFile,
          ),
        ).bytes();
        const text = verifiedPublisherLicenseText(
          publisherSource,
          raw,
          bytes,
          dependency,
        );
        sources.push({
          path: source.file,
          source: source.source,
          sha256: hash(bytes),
          provenance: "publisher-url",
          sourceSha256: publisherSource.sourceSha256,
        });
        notices.push(
          `\n--- Publisher license declared by this exact locked package: ${publisherSource.licenseUrl}; captured source: ${publisherSource.source} ---\n`,
          text,
        );
      }
    }
  }
  inventory.push({
    dependency,
    runtime,
    declaredLicense: declaration ?? null,
    publisherCopyright: metadata.copyright ?? null,
    licenseUrl: metadata.licenseUrl ?? null,
    packageSha512: library.sha512,
    nuspecSha256: hash(nuspecBytes),
    repository: metadata.repository ?? null,
    sources,
  });
}
await Bun.write(
  path.join(output, "NuGetThirdPartyNotices.txt"),
  notices.join("\n") + "\n",
);
await Bun.write(
  path.join(output, "nuget-license-inventory.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      target: "win-x64",
      assetsSha256: hash(await Bun.file(assetsPath).bytes()),
      dependencies: inventory,
      sourceGaps: gaps,
    },
    null,
    2,
  ) + "\n",
);
if (gaps.some((gap) => gap.runtime))
  throw new Error(
    "NuGet runtime license source gaps remain; see the generated inventory. Packaging is blocked.",
  );
await Bun.write(
  Bun.stdout,
  `NuGet notices: ${String(inventory.length)} locked dependencies; ${String(gaps.length)} explicit build-only source gaps.\n`,
);
