import { expect, test } from "vitest";
import { readdir } from "node:fs/promises";
import path from "node:path";

const skillsRoot = path.resolve(import.meta.dir, "../dot_agents/skills");
const manifestPath = path.join(skillsRoot, "public-sources.json");

type ManifestImport = {
  integration: "adapted" | "vendored";
  localSkillPath: string;
  notes: string;
  upstreamSkillPath: string;
};

type ManifestSource = {
  commit: string;
  imports: ManifestImport[];
  license: string;
  repository: string;
  reviewDate: string;
};

type Manifest = {
  schemaVersion: number;
  sources: ManifestSource[];
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
  return Object.fromEntries(Object.entries(value));
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected non-empty string for ${field}`);
  }
  return value.trim();
}

function parseImport(value: unknown, index: number): ManifestImport {
  const importRecord = record(value);

  const integration = stringValue(
    importRecord["integration"],
    `imports[${String(index)}].integration`,
  );
  if (integration !== "adapted" && integration !== "vendored") {
    throw new Error(`Unsupported integration mode: ${integration}`);
  }

  return {
    integration,
    localSkillPath: stringValue(
      importRecord["localSkillPath"],
      `imports[${String(index)}].localSkillPath`,
    ),
    notes: stringValue(
      importRecord["notes"],
      `imports[${String(index)}].notes`,
    ),
    upstreamSkillPath: stringValue(
      importRecord["upstreamSkillPath"],
      `imports[${String(index)}].upstreamSkillPath`,
    ),
  };
}

function parseSource(value: unknown, index: number): ManifestSource {
  const sourceRecord = record(value);

  const imports = sourceRecord["imports"];
  if (!Array.isArray(imports) || imports.length === 0) {
    throw new Error(`Manifest source ${String(index)} must contain imports`);
  }

  return {
    commit: stringValue(
      sourceRecord["commit"],
      `sources[${String(index)}].commit`,
    ),
    imports: imports.map((entry, importIndex) =>
      parseImport(entry, importIndex),
    ),
    license: stringValue(
      sourceRecord["license"],
      `sources[${String(index)}].license`,
    ),
    repository: stringValue(
      sourceRecord["repository"],
      `sources[${String(index)}].repository`,
    ),
    reviewDate: stringValue(
      sourceRecord["reviewDate"],
      `sources[${String(index)}].reviewDate`,
    ),
  };
}

function parseManifest(value: unknown): Manifest {
  const manifestRecord = record(value);
  if (manifestRecord["schemaVersion"] !== 1) {
    throw new Error("public-sources.json must declare schemaVersion 1");
  }
  const sources = manifestRecord["sources"];
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("public-sources.json must contain sources");
  }

  return {
    schemaVersion: 1,
    sources: sources.map((source, index) => parseSource(source, index)),
  };
}

async function exists(filePath: string): Promise<boolean> {
  return (
    (await Bun.file(filePath).exists()) ||
    (await readdir(filePath)
      .then(() => true)
      .catch(() => false))
  );
}

async function skillDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const directories: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "third-party-licenses") {
      continue;
    }
    const skillPath = path.join(root, entry.name);
    if (await Bun.file(path.join(skillPath, "SKILL.md")).exists()) {
      directories.push(skillPath);
    }
  }
  return directories.sort();
}

function frontmatter(
  content: string,
  skillPath: string,
): { description: string; name: string } {
  const normalized = content.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error(`${skillPath} is missing opening YAML frontmatter`);
  }
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error(`${skillPath} is missing closing YAML frontmatter`);
  }

  const yamlLines = normalized.slice(4, end).split("\n");
  const nameLine = yamlLines.find((line) => line.startsWith("name:"));
  const descriptionIndex = yamlLines.findIndex((line) =>
    line.startsWith("description:"),
  );
  if (nameLine === undefined || descriptionIndex === -1) {
    throw new Error(`${skillPath} needs name and description frontmatter`);
  }

  const name = nameLine.slice(nameLine.indexOf(":") + 1).trim();
  const descriptionLine = yamlLines[descriptionIndex] ?? "";
  const descriptionLines = [
    descriptionLine.slice(descriptionLine.indexOf(":") + 1).trim(),
  ];
  for (const line of yamlLines.slice(descriptionIndex + 1)) {
    if (line.length === 0 || line.startsWith(" ") || line.startsWith("\t")) {
      descriptionLines.push(line.trim());
    } else {
      break;
    }
  }

  const whenToUseLine = yamlLines.find((line) =>
    line.startsWith("when_to_use:"),
  );
  if (whenToUseLine !== undefined) {
    descriptionLines.push(
      whenToUseLine.slice(whenToUseLine.indexOf(":") + 1).trim(),
    );
  }
  const description = descriptionLines.join(" ").replaceAll(/\s+/g, " ").trim();
  if (name.length === 0 || description.length < 20) {
    throw new Error(`${skillPath} has an empty or non-actionable description`);
  }
  if (
    !/\b(?:ask|check|use|when|guide|review|create|manage|build|configure|help)\b/i.test(
      description,
    )
  ) {
    throw new Error(
      `${skillPath} description does not describe an actionable use`,
    );
  }

  return { description, name };
}

async function markdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(filePath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(filePath);
    }
  }
  return files;
}

function localLinks(content: string): string[] {
  const links: string[] = [];
  const pattern = /\]\((?:<([^>]+)>|([^)#?]+)(?:#[^)]*)?)\)/g;
  for (const match of content.matchAll(pattern)) {
    const link = (match[1] ?? match[2] ?? "").trim();
    if (
      !link.startsWith("http://") &&
      !link.startsWith("https://") &&
      !link.startsWith("mailto:") &&
      !link.startsWith("/") &&
      !link.startsWith("#") &&
      !link.startsWith('"') &&
      link.toLowerCase() !== "url"
    ) {
      links.push(link);
    }
  }
  return links;
}

function resourceReferences(content: string): string[] {
  const references: string[] = [];
  const pattern = /`((?:assets|references|rules|scripts)\/[^`\s]+)`/g;
  for (const match of content.matchAll(pattern)) {
    const reference = match[1] ?? "";
    references.push(reference.replace(/[.,;:]$/, ""));
  }
  return references;
}

test("public skill provenance manifest is complete", async () => {
  const manifest = parseManifest(
    JSON.parse(await Bun.file(manifestPath).text()),
  );
  const importedPaths = new Set<string>();

  for (const source of manifest.sources) {
    expect(source.repository).toMatch(/^https:\/\/github\.com\//);
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(source.license).not.toBe("");
    expect(source.reviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    for (const imported of source.imports) {
      const localPath = path.join(skillsRoot, imported.localSkillPath);
      expect(await exists(localPath)).toBe(true);
      expect(await Bun.file(path.join(localPath, "SKILL.md")).exists()).toBe(
        true,
      );
      importedPaths.add(imported.localSkillPath);
    }
  }

  expect(importedPaths.size).toBeGreaterThan(0);
});

test("every skill has unique actionable frontmatter", async () => {
  const directories = await skillDirectories(skillsRoot);
  const names = new Set<string>();

  for (const directory of directories) {
    const skillFile = path.join(directory, "SKILL.md");
    const metadata = frontmatter(await Bun.file(skillFile).text(), skillFile);
    const directoryName = path.relative(skillsRoot, directory);
    expect(metadata.name).toBe(directoryName);
    expect(names.has(metadata.name)).toBe(false);
    names.add(metadata.name);
  }
});

test("skill markdown references resolve to local resources", async () => {
  const manifest = parseManifest(
    JSON.parse(await Bun.file(manifestPath).text()),
  );
  const directories = [
    ...new Set(
      manifest.sources.flatMap((source) =>
        source.imports.map((imported) =>
          path.join(skillsRoot, imported.localSkillPath),
        ),
      ),
    ),
  ];

  for (const directory of directories) {
    for (const markdownFile of await markdownFiles(directory)) {
      const content = await Bun.file(markdownFile).text();
      for (const link of localLinks(content)) {
        const target = path.resolve(path.dirname(markdownFile), link);
        if (!(await exists(target))) {
          throw new Error(`Missing local link ${link} from ${markdownFile}`);
        }
      }
      for (const reference of resourceReferences(content)) {
        const target = path.resolve(path.dirname(markdownFile), reference);
        if (!(await exists(target))) {
          throw new Error(
            `Missing referenced resource ${reference} from ${markdownFile}`,
          );
        }
      }
    }
  }
});
