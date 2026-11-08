import { mkdtemp, lstat, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runMediaTool, type RunMediaTool } from "./media-tools.ts";

export type ArchiveMember = { name: string; size: number; directory: boolean };
const MemberSchema = z.object({
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  directory: z.boolean(),
});

export function parseArchiveListing(text: string): ArchiveMember[] {
  const blocks = text
    .trim()
    .split(/\r?\n\r?\n/u)
    .filter((block) => block.trim() !== "");
  if (blocks.length === 0 || blocks.length > 256)
    throw new Error("Subtitle archive member count exceeded");
  const names = new Set<string>();
  let expandedBytes = 0;
  return blocks.map((block) => {
    const fields = new Map<string, string>();
    for (const line of block.split(/\r?\n/u)) {
      const separator = line.indexOf(" = ");
      if (separator < 1) throw new Error("Invalid subtitle archive listing");
      const key = line.slice(0, separator);
      if (fields.has(key))
        throw new Error("Ambiguous subtitle archive listing");
      fields.set(key, line.slice(separator + 3));
    }
    const rawSize = fields.get("Size");
    if (rawSize === undefined || !/^\d+$/u.test(rawSize))
      throw new Error("Subtitle archive entry size missing");
    const member = MemberSchema.parse({
      name: fields.get("Path"),
      size: Number(rawSize),
      directory: fields.get("Folder") === "+",
    });
    validateArchiveMember(member, fields);
    if (names.has(member.name))
      throw new Error("Duplicate subtitle archive member");
    names.add(member.name);
    expandedBytes += member.size;
    if (expandedBytes > 32 * 1024 * 1024)
      throw new Error("Subtitle archive expanded size exceeded");
    return member;
  });
}

function validateArchiveMember(
  member: ArchiveMember,
  fields: ReadonlyMap<string, string>,
): void {
  if (
    member.name.startsWith("/") ||
    member.name.includes("\\") ||
    member.name.includes(":") ||
    /\p{Cc}/u.test(member.name) ||
    member.name
      .split("/")
      .some((part) => part === ".." || part === "." || part === "")
  )
    throw new Error("Unsafe subtitle archive member path");
  if (fields.get("Encrypted") !== "-")
    throw new Error("Encrypted subtitle archives require intervention");
  const attributes = fields.get("Attributes") ?? "";
  if (
    fields.has("Symbolic Link") ||
    fields.has("Hard Link") ||
    /(?:^|\s)l[rwxstST-]{9}/u.test(attributes)
  )
    throw new Error("Subtitle archive links are forbidden");
}

/** Extract one explicitly chosen member to stdout; archives never write paths into the library. */
export async function extractSubtitleArchive(
  input: {
    bytes: Uint8Array;
    member: string | ((members: readonly ArchiveMember[]) => string);
    temporaryRoot: string;
  },
  options: { run?: RunMediaTool; signal?: AbortSignal } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > 32 * 1024 * 1024)
    throw new Error("Subtitle archive compressed size exceeded");
  const root = path.resolve(input.temporaryRoot);
  const info = await lstat(root);
  if (!info.isDirectory() || (await realpath(root)) !== root)
    throw new Error("Invalid subtitle temporary root");
  const temporary = await mkdtemp(path.join(root, "subtitle-"));
  const archive = path.join(temporary, "input.archive");
  const run = options.run ?? runMediaTool;
  try {
    await writeFile(archive, input.bytes, { flag: "wx", mode: 0o600 });
    const listing = await run(
      "7zz",
      ["l", "-slt", "-ba", "-sccUTF-8", "--", archive],
      {
        maxBytes: 512 * 1024,
        timeoutMs: 30_000,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    const members = parseArchiveListing(new TextDecoder().decode(listing));
    const selectedName =
      typeof input.member === "string" ? input.member : input.member(members);
    const matches = members.filter(
      (member) => member.name === selectedName && !member.directory,
    );
    const selected = matches[0];
    if (
      selected === undefined ||
      matches.length !== 1 ||
      selected.size === 0 ||
      selected.size > 8 * 1024 * 1024 ||
      !/\.(?:srt|ass|ssa|vtt)$/iu.test(selected.name)
    )
      throw new Error("Subtitle archive member selection is invalid");
    const bytes = await run(
      "7zz",
      ["e", "-so", "-spd", "--", archive, selected.name],
      {
        maxBytes: 8 * 1024 * 1024,
        timeoutMs: 30_000,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    if (bytes.byteLength !== selected.size)
      throw new Error("Subtitle archive member size mismatch");
    return bytes;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
