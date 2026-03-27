import path from "node:path";

const HOME = Bun.env["HOME"] ?? "~";

export const RECALL_DIR = path.join(HOME, ".recall");
export const LANCE_DIR = path.join(RECALL_DIR, "lance");
export const SQLITE_PATH = path.join(RECALL_DIR, "recall.db");
export const LOGS_DIR = path.join(RECALL_DIR, "logs");
export const FETCHED_DIR = path.join(RECALL_DIR, "fetched");

export const EMBEDDING_DIM = 1024;
export const CHUNK_SIZE = 200; // tokens — bge-m3 via mlx-embedding-models has ~512 token limit, keep well under
export const CHUNK_OVERLAP = 20;

export const WATCHED_DIRS: WatchedDir[] = [
  {
    directory: path.join(HOME, ".claude", "plans"),
    patterns: ["*.md"],
    source: "claude-plan",
    recursive: true,
  },
  {
    directory: path.join(HOME, ".claude-extra"),
    patterns: ["*.md"],
    source: "claude-extra",
    recursive: true,
  },
  {
    directory: path.join(HOME, ".claude", "research"),
    patterns: ["*.md"],
    source: "claude-research",
    recursive: true,
  },
  {
    directory: path.join(HOME, ".claude", "projects"),
    patterns: ["*.md"],
    source: "claude-memory",
    recursive: true,
  },
  {
    directory: FETCHED_DIR,
    patterns: ["*.md"],
    source: "fetched",
    recursive: true,
  },
  {
    directory: path.join(HOME, "git", "monorepo", "packages", "docs"),
    patterns: ["*.md"],
    source: "monorepo-docs",
    recursive: true,
  },
  {
    directory: path.join(HOME, ".claude", "projects"),
    patterns: ["*.jsonl"],
    source: "claude-conversation",
    recursive: true,
  },
];

export type WatchedDir = {
  directory: string;
  patterns: string[];
  source: string;
  recursive: boolean;
  pathFilter?: (path: string) => boolean;
};
