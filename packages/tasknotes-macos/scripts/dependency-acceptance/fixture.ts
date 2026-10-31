import assert from "node:assert/strict";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const dependencyTest = "testDependencyOptionsAndEditsSurviveColdLaunch";
export const dependencyPath = "Tasks/Dependent.md";
export const originalDependencies = [
  {
    uid: "[[Tasks/Target.md|Alias]]",
    reltype: "FINISHTOSTART",
    gap: "P1D",
    vendor: { keep: false, values: [1, "exact"] },
  },
  {
    uid: "Tasks/Keep.md",
    reltype: "FINISHTOFINISH",
    gap: "-PT1H",
    vendorSibling: { exact: "keep: punctuation" },
  },
] as const;

export function dependencyFixture(): Record<string, string> {
  return {
    "tasknotes.yaml":
      "title:\n  storage: frontmatter\ntask_detection:\n  method: tag\n  tag: task\ndependencies:\n  default_reltype: STARTTOSTART\n",
    "Reference.md":
      "# Dependency reference\n\nKeep [[Tasks/Dependent]] and punctuation exact.\n",
    "Assets/unchanged.txt": "Untouched dependency attachment.\n",
    "Tasks/Target.md": "# Target\n",
    "Tasks/Keep.md": "# Keep\n",
    "Tasks/Second.md": "# Second\n",
    [dependencyPath]: `---\ntitle: Dependency acceptance task\nstatus: open\npriority: normal\ntags: [task]\ndateCreated: '2026-10-25T12:00:00Z'\ndateModified: '2026-10-25T12:00:00Z'\nvendorNote: { exact: 'preserve: punctuation', enabled: false }\nblockedBy: ${JSON.stringify(originalDependencies)}\n---\nPreserve **Markdown**, [[Reference]], and trailing spaces.  \nSecond line.\n`,
  };
}

export async function seedDependencyVault(vault: string): Promise<void> {
  await mkdir(path.dirname(vault), { recursive: true });
  await mkdir(vault, { recursive: false });
  for (const [relative, content] of Object.entries(dependencyFixture())) {
    const destination = path.join(vault, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, { flag: "wx", mode: 0o600 });
  }
}

function document(source: string): {
  properties: Record<string, unknown>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
  assert.ok(match?.[1]);
  const properties: unknown = Bun.YAML.parse(match[1]);
  assert.ok(
    properties !== null &&
      typeof properties === "object" &&
      !Array.isArray(properties),
  );
  return {
    properties: Object.fromEntries(Object.entries(properties)),
    body: source.slice(match[0].length),
  };
}

async function inventory(vault: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(vault, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    assert.ok(!entry.isSymbolicLink(), `Unexpected symlink: ${relative}`);
    if (entry.isDirectory())
      files.push(
        ...(await inventory(path.join(vault, entry.name), relative + "/")),
      );
    else {
      assert.ok(entry.isFile(), `Unexpected non-file: ${relative}`);
      files.push(relative);
    }
  }
  return files.sort();
}

export async function verifyDependencyVault(
  vault: string,
  edited: boolean,
): Promise<Record<string, string>> {
  const metadata = await lstat(vault);
  assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink());
  const fixture = dependencyFixture();
  assert.deepEqual(
    await inventory(vault),
    Object.keys(fixture).sort(),
    "Dependency fixture file set changed",
  );
  const hashes: Record<string, string> = {};
  for (const [relative, original] of Object.entries(fixture)) {
    const actual = await Bun.file(path.join(vault, relative)).text();
    if (!edited || relative !== dependencyPath)
      assert.equal(
        actual,
        original,
        `Collateral dependency change: ${relative}`,
      );
    else {
      const before = document(original);
      const after = document(actual);
      assert.equal(
        after.body,
        before.body,
        "Dependency edit changed Markdown bytes",
      );
      assert.deepEqual(
        after.properties["blockedBy"],
        [
          { ...originalDependencies[0], gap: "P2D" },
          originalDependencies[1],
          { uid: "Tasks/Second.md", reltype: "STARTTOSTART", gap: "PT30M" },
        ],
        "Dependency UID/gap/default/vendor/sibling order changed",
      );
      assert.ok(
        typeof after.properties["dateModified"] === "string" &&
          Number.isFinite(Date.parse(after.properties["dateModified"])),
      );
      for (const key of ["blockedBy", "dateModified"]) {
        delete before.properties[key];
        delete after.properties[key];
      }
      assert.deepEqual(
        after.properties,
        before.properties,
        "Dependency edit changed unrelated properties",
      );
    }
    hashes[relative] = new Bun.CryptoHasher("sha256")
      .update(actual)
      .digest("hex");
  }
  return hashes;
}
