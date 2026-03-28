import path from "node:path";

const DATA_DIR = new URL("../../data", import.meta.url).pathname;

export const LANCE_DIR = path.join(DATA_DIR, "lance");
export const SQLITE_PATH = path.join(DATA_DIR, "leetcode.db");

export const EMBEDDING_DIM = 1024;
export const CHUNK_SIZE = 400; // tokens — bge-m3 via mlx-embedding-models has ~512 token limit
export const CHUNK_OVERLAP = 50;
