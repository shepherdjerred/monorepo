import { getDatabase } from "../client.js";

export type UserPreference = {
  id: number;
  userId: string;
  guildId: string;
  preferenceKey: string;
  preferenceValue: string;
  updatedAt: string;
};

export function getPreference(
  userId: string,
  guildId: string,
  key: string,
): string | null {
  const db = getDatabase();
  const result = db
    .query<{ preference_value: string }, [string, string, string]>(
      `SELECT preference_value FROM user_preferences
       WHERE user_id = ? AND guild_id = ? AND preference_key = ?`,
    )
    .get(userId, guildId, key);

  return result?.preference_value ?? null;
}

export function setPreference(
  userId: string,
  guildId: string,
  key: string,
  value: string,
): void {
  const db = getDatabase();
  db.run(
    `INSERT INTO user_preferences (user_id, guild_id, preference_key, preference_value, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, guild_id, preference_key) DO UPDATE SET
       preference_value = excluded.preference_value,
       updated_at = datetime('now')`,
    [userId, guildId, key, value],
  );
}

export function deletePreference(
  userId: string,
  guildId: string,
  key: string,
): boolean {
  const db = getDatabase();
  const result = db.run(
    `DELETE FROM user_preferences
     WHERE user_id = ? AND guild_id = ? AND preference_key = ?`,
    [userId, guildId, key],
  );
  return result.changes > 0;
}

export function getAllPreferences(
  userId: string,
  guildId: string,
): Record<string, string> {
  const db = getDatabase();
  const results = db
    .query<
      { preference_key: string; preference_value: string },
      [string, string]
    >(
      `SELECT preference_key, preference_value FROM user_preferences
       WHERE user_id = ? AND guild_id = ?`,
    )
    .all(userId, guildId);

  const preferences: Record<string, string> = {};
  for (const row of results) {
    preferences[row.preference_key] = row.preference_value;
  }
  return preferences;
}

export function clearUserPreferences(userId: string, guildId: string): number {
  const db = getDatabase();
  const result = db.run(
    `DELETE FROM user_preferences WHERE user_id = ? AND guild_id = ?`,
    [userId, guildId],
  );
  return result.changes;
}
