import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import {
  findBestMatch,
  type LibraryEntry,
} from "@shepherdjerred/streambot/sources/library.ts";

/** A parsed user command, decoupled from Discord and from the playback machine. */
export type CommandIntent =
  | { type: "play"; query: string }
  | { type: "skip" }
  | { type: "stop" }
  | { type: "list"; query: string | null }
  | { type: "search"; query: string }
  | { type: "status" }
  | { type: "help" };

const ALIASES: Record<string, CommandIntent["type"]> = {
  play: "play",
  p: "play",
  skip: "skip",
  next: "skip",
  stop: "stop",
  leave: "stop",
  s: "stop",
  list: "list",
  ls: "list",
  search: "search",
  find: "search",
  status: "status",
  np: "status",
  help: "help",
  h: "help",
};

/**
 * Parse a chat message into a {@link CommandIntent}, or null if it isn't a command for us. Pure:
 * no Discord types, fully unit-testable.
 */
export function parseCommand(
  content: string,
  prefix: string,
): CommandIntent | null {
  if (!content.startsWith(prefix)) {
    return null;
  }
  const withoutPrefix = content.slice(prefix.length).trim();
  if (withoutPrefix.length === 0) {
    return null;
  }
  const [rawCommand, ...rest] = withoutPrefix.split(/\s+/u);
  const name = rawCommand?.toLowerCase() ?? "";
  const resolved = ALIASES[name];
  if (resolved === undefined) {
    return null;
  }
  const argument = rest.join(" ").trim();

  switch (resolved) {
    case "play": {
      return argument.length === 0 ? null : { type: "play", query: argument };
    }
    case "search": {
      return argument.length === 0 ? null : { type: "search", query: argument };
    }
    case "list": {
      return { type: "list", query: argument.length === 0 ? null : argument };
    }
    case "skip": {
      return { type: "skip" };
    }
    case "stop": {
      return { type: "stop" };
    }
    case "status": {
      return { type: "status" };
    }
    case "help": {
      return { type: "help" };
    }
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Turn a `play` query into a concrete {@link Source}: prefer a local library match, then an
 * explicit URL, otherwise treat it as a search query resolved by yt-dlp at play time.
 */
export function resolvePlayQuery(
  query: string,
  entries: readonly LibraryEntry[],
): Source {
  const match = findBestMatch(entries, query);
  if (match !== null) {
    return { kind: "file", path: match.path, title: match.title };
  }
  if (isHttpUrl(query)) {
    return { kind: "url", url: query };
  }
  return { kind: "search", query };
}
