import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { autoDetectAppleMailDir, resolveAppleMailDir } from "./config.ts";

describe("autoDetectAppleMailDir", () => {
  test("returns undefined when candidate roots are missing", () => {
    const root = makeTempDir();
    expect(
      autoDetectAppleMailDir([path.join(root, "missing")]),
    ).toBeUndefined();
  });

  test("detects the standard MailMate Messages.noindex Gmail archive", async () => {
    const root = makeTempDir();
    const messages = path.join(
      root,
      "Messages.noindex",
      "IMAP",
      "user%40example.com@imap.gmail.com",
      "[Gmail].mailbox",
      "Archive.mailbox",
      "Messages",
    );
    await writeDirectoryMarker(messages);

    try {
      expect(
        autoDetectAppleMailDir([
          path.join(root, "missing"),
          path.join(root, "Messages.noindex", "IMAP"),
        ]),
      ).toBe(messages);
    } finally {
      await removeDir(root);
    }
  });

  test("detects the legacy com.freron MailMate Gmail archive", async () => {
    const root = makeTempDir();
    const legacyRoot = path.join(
      root,
      "com.freron.MailMate",
      "Messages",
      "IMAP",
    );
    const messages = path.join(
      legacyRoot,
      "user%40example.com@imap.gmail.com",
      "[Gmail].mailbox",
      "Archive.mailbox",
      "Messages",
    );
    await writeDirectoryMarker(messages);

    try {
      expect(autoDetectAppleMailDir([legacyRoot])).toBe(messages);
    } finally {
      await removeDir(root);
    }
  });
});

describe("resolveAppleMailDir", () => {
  test("prefers an explicit mail directory over auto-detection", async () => {
    const root = makeTempDir();
    const detected = path.join(
      root,
      "Messages.noindex",
      "IMAP",
      "user%40example.com@imap.gmail.com",
      "[Gmail].mailbox",
      "Archive.mailbox",
      "Messages",
    );
    await writeDirectoryMarker(detected);

    try {
      expect(
        resolveAppleMailDir("/custom/apple/messages", [
          path.join(root, "Messages.noindex", "IMAP"),
        ]),
      ).toBe("/custom/apple/messages");
    } finally {
      await removeDir(root);
    }
  });
});

function makeTempDir(): string {
  return path.join(tmpdir(), `monarch-config-test-${crypto.randomUUID()}`);
}

async function writeDirectoryMarker(dir: string): Promise<void> {
  await Bun.write(path.join(dir, ".keep"), "");
}

async function removeDir(dir: string): Promise<void> {
  await Bun.spawn(["rm", "-rf", dir]).exited;
}
