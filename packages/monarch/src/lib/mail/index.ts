import path from "node:path";
import { homedir } from "node:os";
import { Glob } from "bun";
import { z } from "zod";
import type { EmailIndexEntry } from "./types.ts";
import { parseHeaders, parseEmailDateHeader } from "./parse.ts";
import { log } from "../logger.ts";

// MailMate stores messages under one of several roots depending on how it was
// installed and whether Spotlight indexing is disabled. Naming only one leaves
// an install on any of the others with an empty index and no way to recover.
const MAILMATE_ROOTS = [
  path.join(
    homedir(),
    "Library",
    "Application Support",
    "MailMate",
    "Messages",
    "IMAP",
  ),
  path.join(
    homedir(),
    "Library",
    "Application Support",
    "MailMate",
    "Messages.noindex",
    "IMAP",
  ),
  path.join(
    homedir(),
    "Library",
    "Containers",
    "com.freron.MailMate",
    "Data",
    "Library",
    "Application Support",
    "MailMate",
    "Messages",
    "IMAP",
  ),
];

// Scanning a directory that is not there throws; that is the cheapest
// existence check Bun offers for a directory.
function directoryExists(dir: string): boolean {
  try {
    for (const _ of new Glob("*").scanSync(dir)) break;
    return true;
  } catch {
    return false;
  }
}

// The first root that exists. `MONARCH_MAIL_DIR` overrides the search, so an
// unusual install is still reachable without a code change.
export function mailmateRoot(): string {
  const override = Bun.env["MONARCH_MAIL_DIR"];
  if (override !== undefined && override !== "") return override;
  for (const root of MAILMATE_ROOTS) {
    if (directoryExists(root)) return root;
  }
  return MAILMATE_ROOTS[0] ?? "";
}

const INDEX_PATH = path.join(homedir(), ".monarch-cache", "email-index.jsonl");

// Long Received/ARC/spam chains push From:/Subject: several KB into the
// file; 32KB reliably captures the header block.
const HEADER_READ_BYTES = 32 * 1024;

// Machine-noise and non-received mailboxes that never contain purchase mail.
const SKIP_MAILBOX_PATTERN =
  /alerts|pagerduty|npm|bugsink|dmarc|junk|spam|sent|trash|deleted|drafts|calendar/i;

const EmailIndexEntrySchema = z.object({
  path: z.string(),
  account: z.string(),
  mailbox: z.string(),
  from: z.string(),
  subject: z.string(),
  date: z.string(),
});

// New mail arrives constantly, and an index that is only ever rebuilt on
// demand means a vendor reading it never sees a receipt that arrived since the
// first run — the Apple and loan paths both read it with no flag to pass.
const INDEX_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function indexIsFresh(): boolean {
  const modified = Bun.file(INDEX_PATH).lastModified;
  return (
    Number.isFinite(modified) &&
    modified > 0 &&
    Date.now() - modified < INDEX_MAX_AGE_MS
  );
}

export async function loadEmailIndex(
  rebuild = false,
  mailRoot = mailmateRoot(),
): Promise<EmailIndexEntry[]> {
  if (!rebuild && !indexIsFresh() && (await Bun.file(INDEX_PATH).exists())) {
    log.info("Email index is stale; rebuilding so new mail is visible");
  }
  if (!rebuild && indexIsFresh() && (await Bun.file(INDEX_PATH).exists())) {
    const text = await Bun.file(INDEX_PATH).text();
    const lines = text.split("\n");
    const entries: EmailIndexEntry[] = [];
    for (const line of lines) {
      if (line === "") continue;
      entries.push(EmailIndexEntrySchema.parse(JSON.parse(line)));
    }
    log.info(`Loaded email index: ${String(entries.length)} messages`);
    return entries;
  }
  const entries = await buildEmailIndex(mailRoot);
  await Bun.write(
    INDEX_PATH,
    `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
  log.info(`Built email index: ${String(entries.length)} messages`);
  return entries;
}

export async function buildEmailIndex(
  mailRoot = mailmateRoot(),
): Promise<EmailIndexEntry[]> {
  const glob = new Glob("*/**/Messages/*.eml");
  const files: string[] = [];
  for await (const file of glob.scan(mailRoot)) {
    files.push(file);
  }
  log.info(`Indexing ${String(files.length)} messages...`);

  const entries: EmailIndexEntry[] = [];
  let skipped = 0;
  let processed = 0;
  for (const relative of files) {
    processed++;
    if (processed % 5000 === 0) {
      log.progress(processed, files.length, "messages indexed");
    }
    const segments = relative.split("/");
    const account = decodeURIComponent(segments[0] ?? "").split("@")[0] ?? "";
    const mailbox = segments.slice(1, -2).join("/");
    if (SKIP_MAILBOX_PATTERN.test(mailbox)) {
      skipped++;
      continue;
    }

    const fullPath = path.join(mailRoot, relative);
    const head = await readHead(fullPath);
    const headers = parseHeaders(head);
    entries.push({
      path: fullPath,
      account,
      mailbox,
      from: headers["from"] ?? "",
      subject: headers["subject"] ?? "",
      date: parseEmailDateHeader(headers["date"] ?? ""),
    });
  }
  log.info(
    `Indexed ${String(entries.length)} messages (skipped ${String(skipped)} in noise mailboxes)`,
  );
  return entries;
}

async function readHead(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const slice = file.slice(0, HEADER_READ_BYTES);
  return new TextDecoder("utf-8", { fatal: false }).decode(
    await slice.arrayBuffer(),
  );
}

// MailMate moves message files as it synchronizes, so a path the index
// recorded can be gone by the time a vendor reads it. That is ordinary, not
// corruption: the message is skipped rather than aborting the run.
export async function readIndexedEmail(
  entry: EmailIndexEntry,
): Promise<string | undefined> {
  const file = Bun.file(entry.path);
  return (await file.exists()) ? file.text() : undefined;
}
