import { Database } from "bun:sqlite";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/index.js";

export type PersonaMessage = {
  id: string;
  content: string;
  timestamp: string;
};

export type PersonaUser = {
  id: string;
  username: string;
  global_name: string | null;
};

let db: Database | null = null;
let ftsInitialized = false;

export function getPersonaDb(): Database {
  if (!db) {
    const config = getConfig();
    db = new Database(config.persona.dbPath, { readonly: true });
    logger.debug("Persona database opened", { path: config.persona.dbPath });
  }
  return db;
}

function ensureFtsTable(): void {
  if (ftsInitialized) return;

  const database = getPersonaDb();

  // Check if FTS table already exists
  const exists = database
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'",
    )
    .get();

  if (!exists) {
    try {
      logger.debug("Creating FTS5 virtual table for message search...");
      // Create FTS5 virtual table for full-text search
      database.run(`
        CREATE VIRTUAL TABLE messages_fts USING fts5(
          content,
          content='messages',
          content_rowid='rowid'
        );
      `);
      // Populate the FTS index
      database.run(`
        INSERT INTO messages_fts(messages_fts) VALUES('rebuild');
      `);
      logger.info("FTS5 virtual table created successfully");
    } catch (error) {
      // FTS creation fails on read-only databases - this is expected
      // The code will fall back to LIKE queries which work fine
      logger.debug(
        "FTS table not available (database is read-only), using fallback search method",
        { error },
      );
    }
  }

  ftsInitialized = true;
}

export function getPersonaByUsername(username: string): PersonaUser | null {
  const database = getPersonaDb();
  const result = database
    .query<PersonaUser, [string]>(
      "SELECT id, username, global_name FROM users WHERE LOWER(username) = LOWER(?)",
    )
    .get(username);
  return result ?? null;
}

export function getSimilarMessages(
  personaId: string,
  query: string,
  limit: number,
): PersonaMessage[] {
  ensureFtsTable();
  const database = getPersonaDb();

  // Extract keywords from query for FTS matching
  const keywords = extractKeywords(query);
  if (keywords.length === 0) {
    return [];
  }

  const ftsQuery = keywords.join(" OR ");

  try {
    // Use FTS5 to find similar messages
    const results = database
      .query<PersonaMessage, [string, string, number]>(
        `
        SELECT m.id, m.content, m.timestamp
        FROM messages m
        JOIN messages_fts fts ON m.rowid = fts.rowid
        WHERE m.author_id = ?
          AND m.content IS NOT NULL
          AND length(m.content) > 5
          AND messages_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `,
      )
      .all(personaId, ftsQuery, limit);
    return results;
  } catch {
    // Fallback to LIKE query if FTS fails
    logger.debug("FTS query failed, falling back to LIKE search");
    return getFallbackSimilarMessages(personaId, keywords, limit);
  }
}

function getFallbackSimilarMessages(
  personaId: string,
  keywords: string[],
  limit: number,
): PersonaMessage[] {
  const database = getPersonaDb();

  // Build LIKE conditions for each keyword
  const likeConditions = keywords.map(() => "content LIKE ?").join(" OR ");
  const likeParams = keywords.map((k) => `%${k}%`);

  const results = database
    .query<PersonaMessage, [string, ...string[], number]>(
      `
      SELECT id, content, timestamp
      FROM messages
      WHERE author_id = ?
        AND content IS NOT NULL
        AND length(content) > 5
        AND (${likeConditions})
      ORDER BY RANDOM()
      LIMIT ?
    `,
    )
    .all(personaId, ...likeParams, limit);
  return results;
}

export function getRandomMessages(
  personaId: string,
  limit: number,
  excludeIds: string[] = [],
): PersonaMessage[] {
  const database = getPersonaDb();

  let query: string;
  let params: (string | number)[];

  if (excludeIds.length > 0) {
    const placeholders = excludeIds.map(() => "?").join(",");
    query = `
      SELECT id, content, timestamp
      FROM messages
      WHERE author_id = ?
        AND content IS NOT NULL
        AND length(content) > 5
        AND id NOT IN (${placeholders})
      ORDER BY RANDOM()
      LIMIT ?
    `;
    params = [personaId, ...excludeIds, limit];
  } else {
    query = `
      SELECT id, content, timestamp
      FROM messages
      WHERE author_id = ?
        AND content IS NOT NULL
        AND length(content) > 5
      ORDER BY RANDOM()
      LIMIT ?
    `;
    params = [personaId, limit];
  }

  const results = database
    .query<PersonaMessage, (string | number)[]>(query)
    .all(...params);
  return results;
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "can",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "or",
    "and",
    "but",
    "if",
    "then",
    "so",
    "than",
    "that",
    "this",
    "it",
    "its",
    "my",
    "your",
    "i",
    "me",
    "you",
    "we",
    "they",
    "what",
    "which",
    "who",
    "when",
    "where",
    "why",
    "how",
    "hey",
    "hi",
    "hello",
    "please",
    "thanks",
    "thank",
    "just",
    "like",
    "know",
    "think",
    "want",
    "need",
    "get",
    "got",
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .slice(0, 10);
}

export function closePersonaDb(): void {
  if (db) {
    db.close();
    db = null;
    ftsInitialized = false;
    logger.debug("Persona database closed");
  }
}
