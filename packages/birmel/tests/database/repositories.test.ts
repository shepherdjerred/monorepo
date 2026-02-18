import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
// eslint-disable-next-line custom-rules/no-parent-imports, custom-rules/require-ts-extensions -- test setup file in sibling directory
import "../setup.js";

// Create an in-memory database for testing
let testDb: Database;

describe("database repositories", () => {
  beforeEach(() => {
    // Create a fresh in-memory database for each test
    testDb = new Database(":memory:");

    // Create the tables
    testDb.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'text' CHECK (source IN ('text', 'voice')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      )
    `);

    testDb.run(`
      CREATE TABLE IF NOT EXISTS server_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT NOT NULL,
        actor_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    testDb.run(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        preference_key TEXT NOT NULL,
        preference_value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, guild_id, preference_key)
      )
    `);

    testDb.run(`
      CREATE TABLE IF NOT EXISTS music_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        track_title TEXT NOT NULL,
        track_url TEXT NOT NULL,
        track_duration INTEGER,
        played_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  afterEach(() => {
    testDb.close();
  });

  describe("conversations repository", () => {
    test("addMessage inserts a message", () => {
      const result = testDb.run(
        `INSERT INTO conversations (guild_id, channel_id, user_id, role, content, source)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["guild1", "channel1", "user1", "user", "Hello", "text"],
      );

      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    test("addMessage with metadata", () => {
      const metadata = JSON.stringify({ key: "value" });
      const result = testDb.run(
        `INSERT INTO conversations (guild_id, channel_id, user_id, role, content, source, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ["guild1", "channel1", "user1", "user", "Hello", "text", metadata],
      );

      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    test("getRecentMessages retrieves messages", () => {
      testDb.run(
        `INSERT INTO conversations (guild_id, channel_id, user_id, role, content)
         VALUES (?, ?, ?, ?, ?)`,
        ["guild1", "channel1", "user1", "user", "Message 1"],
      );
      testDb.run(
        `INSERT INTO conversations (guild_id, channel_id, user_id, role, content)
         VALUES (?, ?, ?, ?, ?)`,
        ["guild1", "channel1", "user1", "assistant", "Message 2"],
      );

      const results = testDb
        .query<
          { content: string },
          [string, string, number]
        >(`SELECT * FROM conversations WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?`)
        .all("guild1", "user1", 10);

      expect(results.length).toBe(2);
    });

    test("clearOldMessages removes old entries", () => {
      // Insert an old message
      testDb.run(
        `INSERT INTO conversations (guild_id, channel_id, user_id, role, content, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now', '-60 days'))`,
        ["guild1", "channel1", "user1", "user", "Old message"],
      );

      // Insert a recent message
      testDb.run(
        `INSERT INTO conversations (guild_id, channel_id, user_id, role, content)
         VALUES (?, ?, ?, ?, ?)`,
        ["guild1", "channel1", "user1", "user", "Recent message"],
      );

      const result = testDb.run(
        `DELETE FROM conversations WHERE created_at < datetime('now', '-30 days')`,
      );

      expect(result.changes).toBe(1);
    });
  });

  describe("server_events repository", () => {
    test("recordEvent inserts an event", () => {
      const eventData = JSON.stringify({ memberId: "123", action: "join" });
      const result = testDb.run(
        `INSERT INTO server_events (guild_id, event_type, event_data, actor_id)
         VALUES (?, ?, ?, ?)`,
        ["guild1", "member_join", eventData, "user1"],
      );

      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    test("getRecentEvents retrieves events", () => {
      testDb.run(
        `INSERT INTO server_events (guild_id, event_type, event_data)
         VALUES (?, ?, ?)`,
        ["guild1", "member_join", "{}"],
      );
      testDb.run(
        `INSERT INTO server_events (guild_id, event_type, event_data)
         VALUES (?, ?, ?)`,
        ["guild1", "member_leave", "{}"],
      );

      const results = testDb
        .query<
          { event_type: string },
          [string, number]
        >(`SELECT * FROM server_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?`)
        .all("guild1", 10);

      expect(results.length).toBe(2);
    });
  });

  describe("user_preferences repository", () => {
    test("setPreference inserts a preference", () => {
      const result = testDb.run(
        `INSERT INTO user_preferences (user_id, guild_id, preference_key, preference_value)
         VALUES (?, ?, ?, ?)`,
        ["user1", "guild1", "theme", "dark"],
      );

      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    test("getPreference retrieves a preference", () => {
      testDb.run(
        `INSERT INTO user_preferences (user_id, guild_id, preference_key, preference_value)
         VALUES (?, ?, ?, ?)`,
        ["user1", "guild1", "theme", "dark"],
      );

      const result = testDb
        .query<
          { preference_value: string },
          [string, string, string]
        >(`SELECT preference_value FROM user_preferences WHERE user_id = ? AND guild_id = ? AND preference_key = ?`)
        .get("user1", "guild1", "theme");

      expect(result?.preference_value).toBe("dark");
    });

    test("setPreference updates existing preference", () => {
      testDb.run(
        `INSERT INTO user_preferences (user_id, guild_id, preference_key, preference_value)
         VALUES (?, ?, ?, ?)`,
        ["user1", "guild1", "theme", "dark"],
      );

      testDb.run(
        `INSERT OR REPLACE INTO user_preferences (user_id, guild_id, preference_key, preference_value)
         VALUES (?, ?, ?, ?)`,
        ["user1", "guild1", "theme", "light"],
      );

      const result = testDb
        .query<
          { preference_value: string },
          [string, string, string]
        >(`SELECT preference_value FROM user_preferences WHERE user_id = ? AND guild_id = ? AND preference_key = ?`)
        .get("user1", "guild1", "theme");

      expect(result?.preference_value).toBe("light");
    });

    test("getAllPreferences retrieves all preferences for a user", () => {
      testDb.run(
        `INSERT INTO user_preferences (user_id, guild_id, preference_key, preference_value)
         VALUES (?, ?, ?, ?)`,
        ["user1", "guild1", "theme", "dark"],
      );
      testDb.run(
        `INSERT INTO user_preferences (user_id, guild_id, preference_key, preference_value)
         VALUES (?, ?, ?, ?)`,
        ["user1", "guild1", "notifications", "enabled"],
      );

      const results = testDb
        .query<
          { preference_key: string; preference_value: string },
          [string, string]
        >(`SELECT preference_key, preference_value FROM user_preferences WHERE user_id = ? AND guild_id = ?`)
        .all("user1", "guild1");

      expect(results.length).toBe(2);
    });
  });

  describe("music_history repository", () => {
    test("recordTrackPlay inserts a track", () => {
      const result = testDb.run(
        `INSERT INTO music_history (guild_id, channel_id, requested_by, track_title, track_url, track_duration)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "guild1",
          "channel1",
          "user1",
          "Test Song",
          "https://example.com",
          180,
        ],
      );

      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    test("getRecentTracks retrieves tracks", () => {
      testDb.run(
        `INSERT INTO music_history (guild_id, channel_id, requested_by, track_title, track_url)
         VALUES (?, ?, ?, ?, ?)`,
        ["guild1", "channel1", "user1", "Song 1", "https://example.com/1"],
      );
      testDb.run(
        `INSERT INTO music_history (guild_id, channel_id, requested_by, track_title, track_url)
         VALUES (?, ?, ?, ?, ?)`,
        ["guild1", "channel1", "user2", "Song 2", "https://example.com/2"],
      );

      const results = testDb
        .query<
          { track_title: string },
          [string, number]
        >(`SELECT * FROM music_history WHERE guild_id = ? ORDER BY played_at DESC LIMIT ?`)
        .all("guild1", 10);

      expect(results.length).toBe(2);
    });

    test("getTracksByUser retrieves tracks for a specific user", () => {
      testDb.run(
        `INSERT INTO music_history (guild_id, channel_id, requested_by, track_title, track_url)
         VALUES (?, ?, ?, ?, ?)`,
        ["guild1", "channel1", "user1", "Song 1", "https://example.com/1"],
      );
      testDb.run(
        `INSERT INTO music_history (guild_id, channel_id, requested_by, track_title, track_url)
         VALUES (?, ?, ?, ?, ?)`,
        ["guild1", "channel1", "user2", "Song 2", "https://example.com/2"],
      );
      testDb.run(
        `INSERT INTO music_history (guild_id, channel_id, requested_by, track_title, track_url)
         VALUES (?, ?, ?, ?, ?)`,
        ["guild1", "channel1", "user1", "Song 3", "https://example.com/3"],
      );

      const results = testDb
        .query<
          { track_title: string },
          [string, string, number]
        >(`SELECT * FROM music_history WHERE guild_id = ? AND requested_by = ? ORDER BY played_at DESC LIMIT ?`)
        .all("guild1", "user1", 10);

      expect(results.length).toBe(2);
    });

    test("getMostPlayedTracks groups by track", () => {
      testDb.run(
        `INSERT INTO music_history (guild_id, channel_id, requested_by, track_title, track_url)
         VALUES (?, ?, ?, ?, ?)`,
        [
          "guild1",
          "channel1",
          "user1",
          "Popular Song",
          "https://example.com/1",
        ],
      );
      testDb.run(
        `INSERT INTO music_history (guild_id, channel_id, requested_by, track_title, track_url)
         VALUES (?, ?, ?, ?, ?)`,
        [
          "guild1",
          "channel1",
          "user2",
          "Popular Song",
          "https://example.com/1",
        ],
      );
      testDb.run(
        `INSERT INTO music_history (guild_id, channel_id, requested_by, track_title, track_url)
         VALUES (?, ?, ?, ?, ?)`,
        ["guild1", "channel1", "user1", "Other Song", "https://example.com/2"],
      );

      const results = testDb
        .query<
          { track_title: string; play_count: number },
          [string, number]
        >(`SELECT track_title, COUNT(*) as play_count FROM music_history WHERE guild_id = ? GROUP BY track_url ORDER BY play_count DESC LIMIT ?`)
        .all("guild1", 10);

      expect(results.length).toBe(2);
      expect(results[0]?.play_count).toBe(2);
    });
  });
});
