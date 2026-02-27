import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { VaultManager } from "./vault.ts";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

function encodeText(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

describe("VaultManager", () => {
  let tempDir: string;
  let vault: VaultManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "obsidian-sync-test-"));
    vault = new VaultManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("initial state", () => {
    expect(vault.version).toBe(0);
    expect(Object.keys(vault.files)).toHaveLength(0);
    expect(vault.isInitialSync).toBe(true);
  });

  test("save and load state", async () => {
    vault.version = 42;
    vault.files["test.md"] = {
      uid: 1,
      path: "test.md",
      hash: "abc123",
      mtime: 1000,
      ctime: 900,
      size: 100,
      folder: false,
      deleted: false,
    };
    await vault.saveState();

    const vault2 = new VaultManager(tempDir);
    await vault2.loadState();
    expect(vault2.version).toBe(42);
    expect(vault2.files["test.md"]?.hash).toBe("abc123");
  });

  test("loadState handles missing file", async () => {
    await vault.loadState();
    expect(vault.version).toBe(0);
    expect(Object.keys(vault.files)).toHaveLength(0);
  });

  test("writeFile creates file and updates state", async () => {
    const content = encodeText("Hello, World!");
    await vault.writeFile("notes/test.md", content, {
      uid: 1,
      hash: "abc",
      mtime: 1000,
      ctime: 900,
      size: 13,
      folder: false,
      deleted: false,
    });

    const fullPath = path.join(tempDir, "notes/test.md");
    const written = await readFile(fullPath, "utf8");
    expect(written).toBe("Hello, World!");

    const entry = vault.getEntry("notes/test.md");
    expect(entry?.uid).toBe(1);
    expect(entry?.hash).toBe("abc");
  });

  test("createFolder creates directory", async () => {
    await vault.createFolder("folder/subfolder", {
      uid: 2,
      hash: "",
      mtime: 0,
      ctime: 0,
      size: 0,
      folder: true,
      deleted: false,
    });

    const entry = vault.getEntry("folder/subfolder");
    expect(entry?.folder).toBe(true);
  });

  test("deleteFile marks entry as deleted", async () => {
    const content = encodeText("data");
    await vault.writeFile("deleteme.md", content, {
      uid: 3,
      hash: "xyz",
      mtime: 1000,
      ctime: 900,
      size: 4,
      folder: false,
      deleted: false,
    });

    await vault.deleteFile("deleteme.md");
    const entry = vault.getEntry("deleteme.md");
    expect(entry?.deleted).toBe(true);
  });

  test("readFileContent reads file data", async () => {
    const content = encodeText("file content");
    await vault.writeFile("read.md", content, {
      uid: 4,
      hash: "h",
      mtime: 1000,
      ctime: 900,
      size: 12,
      folder: false,
      deleted: false,
    });

    const data = await vault.readFileContent("read.md");
    const text = new TextDecoder().decode(data);
    expect(text).toBe("file content");
  });

  test("getFileStat returns mtime and size", async () => {
    const content = encodeText("hello");
    await vault.writeFile("stat.md", content, {
      uid: 5,
      hash: "h",
      mtime: 1000,
      ctime: 900,
      size: 5,
      folder: false,
      deleted: false,
    });

    const stats = await vault.getFileStat("stat.md");
    expect(stats).not.toBeNull();
    expect(stats?.size).toBe(5);
    expect(stats?.mtime).toBeGreaterThan(0);
  });

  test("getFileStat returns null for missing file", async () => {
    const stats = await vault.getFileStat("nonexistent.md");
    expect(stats).toBeNull();
  });

  test("removeEntry removes from state", () => {
    vault.files["test.md"] = {
      uid: 1,
      path: "test.md",
      hash: "abc",
      mtime: 1000,
      ctime: 900,
      size: 10,
      folder: false,
      deleted: false,
    };
    vault.removeEntry("test.md");
    expect(vault.getEntry("test.md")).toBeUndefined();
  });
});
